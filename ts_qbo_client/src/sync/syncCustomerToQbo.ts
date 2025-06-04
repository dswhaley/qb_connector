import axios from 'axios';
import { frappe } from '../frappe';
import { fromFrappe } from './mappers';
import { QuickBooksSettings } from '../types';

interface Customer {
  name: string;
  customer_name: string;
  custom_email?: string;
  custom_phone?: string;
  custom_qbo_customer_id?: string;
  custom_qbo_sync_status?: string;
  custom_qbo_last_synced_at?: string;
  custom_customer_exists_in_qbo?: number; // 1 for true, 0 for false
  custom_billing_address?: string;
}

interface QboCustomer {
  Id: string;
  DisplayName?: string;
  BillAddr?: {
    Line1?: string;
    City?: string;
    CountrySubDivisionCode?: string;
    PostalCode?: string;
  };
}

interface QboCustomerQueryResponse {
  QueryResponse: {
    Customer?: QboCustomer[];
  };
}

function toMariaDBDateTimeString(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export async function syncCustomerToQbo(customerName: string): Promise<void> {
  const customer = await frappe.getDoc<Customer>('Customer', customerName);

  // Skip if already synced
  if (customer.custom_qbo_customer_id && customer.custom_qbo_sync_status === 'Synced') {
    console.log(`✅ Customer ${customer.name} is already synced to QBO.`);
    return;
  }

  const rawSettings = await frappe.getDoc<any>('QuickBooks Settings');
  const settings: QuickBooksSettings = fromFrappe(rawSettings);

  const baseUrl =
    process.env.QBO_ENV === 'production'
      ? 'https://quickbooks.api.intuit.com/v3/company'
      : 'https://sandbox-quickbooks.api.intuit.com/v3/company';

  const headers = {
    Authorization: `Bearer ${settings.accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  try {
    // Try matching by DisplayName
    const safeName = customer.customer_name?.replace(/'/g, "\\'");
    const nameQuery = `select * from Customer where DisplayName = '${safeName}'`;

    const nameResp = await axios.get<QboCustomerQueryResponse>(
      `${baseUrl}/${settings.realmId}/query?query=${encodeURIComponent(nameQuery)}`,
      { headers }
    );

    let match = nameResp.data.QueryResponse.Customer?.[0];

    // Fallback to billing address
    if (!match && customer.custom_billing_address) {
      const fullQuery = `select * from Customer`;
      const fullResp = await axios.get<QboCustomerQueryResponse>(
        `${baseUrl}/${settings.realmId}/query?query=${encodeURIComponent(fullQuery)}`,
        { headers }
      );

      const parts = customer.custom_billing_address
        .split(',')
        .map((p) => p.trim().toLowerCase());

      if (parts.length === 4) {
        const [line1, city, state, postalCode] = parts;

        match = fullResp.data.QueryResponse.Customer?.find((qbo) => {
          const addr = qbo.BillAddr;
          return (
            addr &&
            addr.Line1?.trim().toLowerCase() === line1 &&
            addr.City?.trim().toLowerCase() === city &&
            addr.CountrySubDivisionCode?.trim().toLowerCase() === state &&
            addr.PostalCode?.trim().toLowerCase() === postalCode
          );
        });
      } else {
        console.warn(
          `⚠️ Billing address for ${customer.name} is not in expected format: 'Line1, City, State, Zip'`
        );
      }
    }

    if (match) {
      customer.custom_qbo_customer_id = match.Id;
      customer.custom_qbo_sync_status = 'Synced';
      customer.custom_qbo_last_synced_at = toMariaDBDateTimeString(new Date());

      await frappe.updateDoc('Customer', customer);
      console.log(`✅ Linked ${customer.name} to QBO Customer ID ${match.Id}`);
    } else {
      console.log(`🔍 No matching QBO customer found for ${customer.name}`);
    }
  } catch (error: any) {
    console.error(`❌ Failed to sync customer ${customer.name}:`, error.response?.data || error.message);
    try {
      customer.custom_qbo_sync_status = 'Failed';
      await frappe.updateDoc('Customer', customer);
    } catch (e) {
      console.warn(`⚠️ Could not update sync status to 'Failed' for ${customer.name}`);
    }
    throw error;
  }
}

// CLI usage: ts-node src/syncCustomerToQbo.ts "Customer Name"
if (require.main === module) {
  const name = process.argv[2];
  if (!name) {
    console.error('❌ You must pass a Customer name');
    process.exit(1);
  }

  syncCustomerToQbo(name)
    .then(() => console.log('✅ Sync complete'))
    .catch((err) => console.error('❌ Sync failed:', err));
}
