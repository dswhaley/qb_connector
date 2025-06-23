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

function isFilled(str?: string | null): boolean {
  return typeof str === 'string' && str.trim().length > 0;
}

export async function createCustomerInQbo(customerName: string): Promise<void> {
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

  // ✅ Phone
  if (isFilled(customer.custom_phone)) {
    qboCustomer.PrimaryPhone = { FreeFormNumber: customer.custom_phone.trim() };
  } else {
    missing.push('Phone');
  }

  // ✅ Billing Address
  if (isFilled(customer.custom_billing_address)) {
    const parts = customer.custom_billing_address.split(',').map((p: string) => p.trim());
    if (parts.length === 4 && parts.every(isFilled)) {
      const [Line1, City, State, PostalCode] = parts;
      qboCustomer.BillAddr = {
        Line1,
        City,
        CountrySubDivisionCode: State,
        PostalCode,
        Country: "United States"
      };
    } else if(parts.length === 5 && parts.every(isFilled)){
      const[Line1, City, State, PostalCode, countryPart] = parts;
      const Country = isFilled(countryPart) ? countryPart : 'United States';
            qboCustomer.BillAddr = {
        Line1,
        City,
        CountrySubDivisionCode: State,
        PostalCode,
        Country
      };
    }else{
      missing.push('Address');
    }
  } else {
    missing.push('Address');
  }

  // ✅ Sync Status
  let syncStatus = 'Synced';
  if (missing.length === 1) {
    syncStatus = `Missing ${missing[0]}`;
  } else if (missing.length >= 2) {
    syncStatus = 'Missing Multiple Fields';
  }

  if (syncStatus !== 'Synced') {
    await frappe.updateDoc('Customer', {
      name: customer.name,
      custom_qbo_sync_status: syncStatus,
      custom_create_customer_in_qbo: 0,
    });

    console.warn(`⚠️ Skipped QBO creation for ${customer.customer_name}: ${syncStatus}`);
    return;
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

    await frappe.updateDoc('Customer', {
      name: customer.name,
      custom_qbo_customer_id: created.Id,
      custom_qbo_sync_status: 'Synced',
      custom_last_synced_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      custom_customer_exists_in_qbo: 1,
      custom_create_customer_in_qbo: 0,
    });

    console.log(`✅ Created QBO customer '${customer.customer_name}' with ID ${created.Id}`);
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
