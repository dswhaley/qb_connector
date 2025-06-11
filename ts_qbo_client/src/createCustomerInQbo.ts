import axios from 'axios';
import { frappe } from './frappe';
import { fromFrappe } from './sync/mappers';
import { QuickBooksSettings } from './types';
import dayjs from 'dayjs';

interface QboCreateCustomerResponse {
  Customer: {
    Id: string;
    DisplayName?: string;
  };
  time?: string;
}

function isFilled(str?: string | null): boolean {
  return typeof str === 'string' && str.trim().length > 0;
}

export async function createCustomerInQbo(customerName: string): Promise<void> {
  const customer = await frappe.getDoc<any>('Customer', customerName);
  const rawSettings = await frappe.getDoc('QuickBooks Settings');
  const settings: QuickBooksSettings = fromFrappe(rawSettings);


  if (!isFilled(customer.customer_name)) {
    throw new Error(`❌ Cannot create QBO customer without a customer_name`);
  }

  const qboCustomer: any = {
    DisplayName: customer.customer_name.trim(),
  };

  const missing: string[] = [];

  // Email check
  if (isFilled(customer.custom_email)) {
    qboCustomer.PrimaryEmailAddr = { Address: customer.custom_email.trim() };
  } else {
    missing.push('Email');
  }

  // Phone check
  if (isFilled(customer.custom_phone)) {
    qboCustomer.PrimaryPhone = { FreeFormNumber: customer.custom_phone.trim() };
  } else {
    missing.push('Phone');
  }

  // Address check
  if (isFilled(customer.custom_billing_address)) {
    const parts = customer.custom_billing_address.split(',').map((p: string) => p.trim());
    if (parts.length >= 4 && parts.every(isFilled)) {
      const [Line1, City, State, PostalCode] = parts;
      qboCustomer.BillAddr = {
        Line1,
        City,
        CountrySubDivisionCode: State,
        PostalCode,
      };
    } else {
      missing.push('Address');
    }
  } else {
    missing.push('Address');
  }

  // Decide sync status
  let syncStatus = 'Synced';
  if (missing.length === 1) {
    syncStatus = `Missing ${missing[0]}`;
  } else if (missing.length >= 2) {
    syncStatus = 'Missing Multiple Fields';
  }


  // Abort QBO creation if anything is missing
  if (syncStatus !== 'Synced') {
    await frappe.updateDoc('Customer', {
      name: customer.name,
      custom_qbo_sync_status: syncStatus,
      custom_create_customer_in_qbo: 0
    });

    console.warn(`⚠️ Skipped QBO creation for ${customer.customer_name}: ${syncStatus}`);
    return;
  }

  // QBO customer creation
  try {
    const response = await axios.post<QboCreateCustomerResponse>(
      `https://sandbox-quickbooks.api.intuit.com/v3/company/${settings.realmId}/customer`,
      qboCustomer,
      {
        headers: {
          Authorization: `Bearer ${settings.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      }
    );

    const created = response.data?.Customer;

    if (!created?.Id) {
      throw new Error('❌ QBO responded without a valid Customer ID.');
    }

    await frappe.updateDoc('Customer', {
      name: customer.name,
      custom_qbo_customer_id: created.Id,
      custom_qbo_sync_status: 'Synced',
      custom_qbo_last_synced_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      custom_customer_exists_in_qbo: 1,
      custom_create_customer_in_qbo: 0
    });

    console.log(`✅ Created QBO customer '${customer.customer_name}' with ID ${created.Id}`);
  } catch (error: any) {
    console.error(`❌ Failed to create customer '${customer.customer_name}' in QBO:`, error.response?.data || error.message);
    throw error;
  }
}
