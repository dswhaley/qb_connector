import axios from 'axios';
import { frappe } from './frappe';
import { fromFrappe } from './sync/mappers';
import { QuickBooksSettings } from './types';
import { getQboBaseUrl } from './auth';
import dayjs from 'dayjs';

interface QboCreateCustomerResponse {
  Customer: {
    Id: string;
    DisplayName?: string;
  };
  time?: string;
}

interface frappeResponse {
    name: string;
    custom_qbo_customer_id: string;
    custom_qbo_sync_status: string;
    custom_last_synced_at: string;
    custom_customer_exists_in_qbo: number;
    custom_create_customer_in_qbo: number;
}

function isFilled(str?: string | null): boolean {
  return typeof str === 'string' && str.trim().length > 0;
}

export async function createCustomerInQbo(customerName: string): Promise<frappeResponse> {
  const customer = await frappe.getDoc<any>('Customer', customerName);
  const rawSettings = await frappe.getDoc('QuickBooks Settings', 'QuickBooks Settings');
  const settings: QuickBooksSettings = fromFrappe(rawSettings);

  const baseUrl = await getQboBaseUrl(); // ✅ uses QBO_ENV

  if (!isFilled(customer.customer_name)) {
    throw new Error(`❌ Cannot create QBO customer without a customer_name`);
  }

  const qboCustomer: any = {
    DisplayName: customer.customer_name.trim(),
  };

  const missing: string[] = [];

  if (isFilled(customer.default_currency)) {
  qboCustomer.CurrencyRef = {
    value: customer.default_currency.trim().toUpperCase(),
  };

  console.log(qboCustomer.CurrencyRef);
  } else {
    qboCustomer.CurrencyRef = { value: 'USD' };
  }
  
  // ✅ Email
  if (isFilled(customer.custom_email)) {
    qboCustomer.PrimaryEmailAddr = { Address: customer.custom_email.trim() };
  } else {
    missing.push('Email');
  }

  if (isFilled(customer.custom_phone)) {
    qboCustomer.PrimaryPhone = { FreeFormNumber: customer.custom_phone.trim() };
  } else {
    missing.push('Phone');
  }

  // ✅ Billing Address
  console.warn(`Line1 ${customer.custom_street_address_line_1}`);
  console.warn(`Line2 ${customer.custom_street_address_line_2}`);
  console.warn(`City  ${customer.custom_city}`);
  console.warn(`State ${customer.custom_state}`);
  console.warn(`Zip Code: ${customer.custom_zip_code}`);
  console.warn(`Country:  ${customer.custom_country}`)
  if (isFilled(customer.custom_street_address_line_1) && isFilled(customer.custom_city) && isFilled(customer.custom_state) && isFilled(customer.custom_zip_code) && isFilled(customer.custom_country)) {
    const Line1 = customer.custom_street_address_line_1;
    const Line2 = customer.custom_street_address_line_2;
    const City = customer.custom_city;
    const State = customer.custom_state;
    const PostalCode = customer.custom_zip_code;
    const Country = customer.cusom_countryl;
      qboCustomer.BillAddr = {
        Line1,
        Line2,
        City,
        CountrySubDivisionCode: State,
        PostalCode,
        Country
      };
  } else {
    missing.push('Address');
  }

  if (customer.custom_tax_status === "Exempt") {
    qboCustomer.Taxable = false;
  }



  // ✅ Sync Status
  let syncStatus = 'Synced';
  if (missing.length === 1) {
    syncStatus = `Missing ${missing[0]}`;
  } else if (missing.length >= 2) {
    syncStatus = 'Missing Multiple Fields';
  }

  if (syncStatus !== 'Synced') {
    
    console.warn(`❗ Missing fields: ${missing.join(', ')}`);
    console.warn(`⚠️ Skipped QBO creation for ${customer.customer_name}: ${syncStatus}`);
    const responseData: frappeResponse = {
      name: customer.name,
      custom_qbo_customer_id: "",
      custom_last_synced_at: "",
      custom_qbo_sync_status: syncStatus,
      custom_customer_exists_in_qbo: 0,
      custom_create_customer_in_qbo: 0
    }

    return responseData;
  }

  // ✅ POST to QBO
  try {
    const response = await axios.post<QboCreateCustomerResponse>(
      `${baseUrl}/customer`,
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
    const responseData: frappeResponse = {
      name: customer.name,
      custom_qbo_customer_id: created.Id,
      custom_last_synced_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      custom_qbo_sync_status: "Synced",
      custom_customer_exists_in_qbo: 1,
      custom_create_customer_in_qbo: 0
    }
    return responseData;
  } catch (error: any) {
    if (error.response?.data?.Fault) {
      console.error(`❌ Failed to create customer '${customer.customer_name}' in QBO`);
      console.error(JSON.stringify(error.response.data.Fault, null, 2));
    } else {
      console.error(`❌ Failed to create customer '${customer.customer_name}': ${error.message}`);
    }
    throw error;
  }
}

if (require.main === module) {
  const name = process.argv[2];
  if (!name) {
    console.error("❌ Please provide a customer name");
    process.exit(1);
  }

  createCustomerInQbo(name).catch((err) => {
    console.error("❌ Unhandled error:", err);
  });
}