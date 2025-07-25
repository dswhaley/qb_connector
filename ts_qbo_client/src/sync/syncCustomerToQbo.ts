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
  custom_customer_exists_in_qbo?: number;
  custom_street_address_line_1?: string;
  custom_street_address_line_2?: string;
  custom_city?: string;
  custom_state?: string;
  custom_zip_code?: string;
  custom_country?: string;
  custom_tax_status?: string;
}

interface QboCustomer {
  Id: string;
  DisplayName?: string;
  Taxable?: boolean;
  BillAddr?: {
    Line1?: string;
    Line2?: string;
    City?: string;
    CountrySubDivisionCode?: string;
    PostalCode?: string;
    Country?: string;
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

/**
 * Syncs a Frappe customer to QuickBooks Online (QBO).
 * Attempts to match by name and address, and updates Frappe with QBO linkage and sync status.
 * Handles tax status compatibility and error reporting.
 *
 * @param customerName - The name of the Frappe customer to sync
 * @returns 'matched' if linked, 'not_found' if no match, 'skipped' if not eligible
 */
export async function syncCustomerToQbo(customerName: string): Promise<'matched' | 'not_found' | "skipped"> {
  // Fetch customer document from Frappe
  const customer = await frappe.getDoc<Customer>('Customer', customerName);

  // Skip syncing if tax status is pending
  if (customer.custom_tax_status?.toLowerCase() === 'pending') {
    console.warn(`⏭️ Skipping ${customer.name}: tax status is 'Pending'`);
    customer.custom_qbo_sync_status = "Tax Status Unknown";
    await frappe.updateDoc('Customer', customer);
    return "skipped";
  }




  // If customer is already synced, skip further processing
  if (customer.custom_qbo_customer_id && customer.custom_qbo_sync_status === 'Synced') {
    console.log(`✅ Customer ${customer.name} is already synced to QBO.`);
    return 'matched';
  }

  // Fetch QuickBooks settings from Frappe
  const rawSettings = await frappe.getDoc<any>('QuickBooks Settings', 'QuickBooks Settings');
  // Convert Frappe settings to local QuickBooksSettings type
  const settings: QuickBooksSettings = fromFrappe(rawSettings);

  // Determine QBO API base URL based on environment
  const baseUrl =
    process.env.QBO_ENV === 'production'
      ? 'https://quickbooks.api.intuit.com/v3/company'
      : 'https://sandbox-quickbooks.api.intuit.com/v3/company';

  // Build request headers for QBO API
  const headers = {
    Authorization: `Bearer ${settings.accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };


  try {
    // Escape single quotes in customer name for SQL query
    const safeName = customer.customer_name?.replace(/'/g, "\\'");
    // Build query to find QBO customer by display name
    const nameQuery = `select * from Customer where DisplayName = '${safeName}'`;

    // Send GET request to QBO API to search for customer by name
    const nameResp = await axios.get<QboCustomerQueryResponse>(
      `${baseUrl}/${settings.realmId}/query?query=${encodeURIComponent(nameQuery)}`,
      { headers }
    );

    // Try to get the first matching customer from the response
    let match = nameResp.data.QueryResponse.Customer?.[0];

    // If no match by name, try to match by address fields
    if (!match) {
      // Build query to fetch all QBO customers
      const fullQuery = `select * from Customer`;
      // Send GET request to QBO API to fetch all customers
      const fullResp = await axios.get<QboCustomerQueryResponse>(
        `${baseUrl}/${settings.realmId}/query?query=${encodeURIComponent(fullQuery)}`,
        { headers }
      );

      // Extract address fields from Frappe customer
      const line1 = customer.custom_street_address_line_1;
      const line2 = customer.custom_street_address_line_2;
      const city = customer.custom_city;
      const state = customer.custom_state;
      const postalCode = customer.custom_zip_code;
      const country = customer.custom_country;

      // Try to find a QBO customer whose billing address matches all fields
      match = fullResp.data.QueryResponse.Customer?.find((qbo) => {
        const addr = qbo.BillAddr;
        if (!addr) return false; // Skip if no billing address

        // Compare each address field for an exact match
        const line1Match = addr.Line1?.trim() === line1;
        const line2Match = addr.Line2?.trim() === line2;
        const cityMatch = addr.City?.trim() === city;
        const stateMatch = addr.CountrySubDivisionCode?.trim() === state;
        const postalMatch = addr.PostalCode?.trim() === postalCode;

        // Compare country (case-insensitive)
        let countryMatch = true;
        countryMatch = addr.Country?.trim().toLowerCase() === country;

        // Return true if all address fields match
        return line1Match && line2Match && cityMatch && stateMatch && postalMatch && countryMatch;
      });
    } else {
      // Warn if billing address is not in expected format
      console.warn(
        `⚠️ Billing address for ${customer.name} is not in expected format: 'Line1, City, State, Zip[, Country]'`
      );
    }
    

    if (match) {
      const frappeTaxStatus = customer.custom_tax_status?.toLowerCase();
      const qboTaxable = match.Taxable;

      const isTaxStatusCompatible =
        (frappeTaxStatus === 'exempt' && qboTaxable === false) ||
        (frappeTaxStatus === 'taxed' && qboTaxable === true);

      if (!isTaxStatusCompatible) {
        console.warn(`❌ Tax status mismatch for ${customer.name}. Frappe: '${frappeTaxStatus}', QBO: '${qboTaxable}'`);
        customer.custom_qbo_sync_status = "Tax Status Mismatch";
        await frappe.updateDoc('Customer', customer);
        return "skipped";
      }

      customer.custom_qbo_customer_id = match.Id;
      customer.custom_qbo_sync_status = 'Synced';
      customer.custom_qbo_last_synced_at = toMariaDBDateTimeString(new Date());

      await frappe.updateDoc('Customer', customer);
      console.log(`✅ Linked ${customer.name} to QBO Customer ID ${match.Id}`);
      return 'matched';

    } else {
      console.log(`🔍 No matching QBO customer found for ${customer.name}`);
      return 'not_found';
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

if (require.main === module) {
  const name = process.argv[2];
  if (!name) {
    console.error('❌ You must pass a Customer name');
    process.exit(1);
  }

  syncCustomerToQbo(name)
    .then((res) => console.log(`Result: ${res}`))
    .catch((err) => console.error('❌ Sync failed:', err));
}
