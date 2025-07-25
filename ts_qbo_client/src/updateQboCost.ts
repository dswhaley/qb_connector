// Imports for Frappe API, QBO authentication, type mapping, HTTP requests, and date handling
import { frappe } from './frappe';
import { getQboAuthHeaders, getQboBaseUrl } from './auth';
import { fromFrappe } from './sync/mappers';
import { QuickBooksSettings } from './types';
import axios from 'axios';
import dayjs from 'dayjs';

// Type for QBO Item
interface QboItem {
  Id: string;
  Name: string;
  SyncToken: string;
  UnitPrice?: number;
  PurchaseCost?: number;
}

// Type for QBO Item API response
interface QboItemResponse {
  Item: QboItem;
}

// Utility to check if a value is filled (not empty/null/undefined)
function isFilled(val: any): boolean {
  return typeof val === 'string' ? val.trim().length > 0 : val !== undefined && val !== null;
}

// Utility to log messages and optional objects to stdout
function log(msg: string, obj?: any) {
  process.stdout.write(`${msg}\n`);
  if (obj !== undefined) {
    process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  }
}

// Main function to update the cost of a QBO item from ERPNext
async function main() {
  // Get item name and new cost from command line arguments
  const itemName = process.argv[2];
  const newCost = parseFloat(process.argv[3]);
  if (!isFilled(itemName)) {
    process.exit(1);
  }

  // Fetch item from Frappe
  const item = await frappe.getDoc<any>('Item', itemName);

  // Ensure item has QBO ID and valuation rate
  if (!item.custom_qbo_item_id || !item.valuation_rate) {
    log(`ℹ️ Skipping item '${item.name}' — No QBO ID or valuation rate.`);
    return;
  }

  // Get QBO API base URL and auth headers
  const baseUrl = await getQboBaseUrl();
  const headers = await getQboAuthHeaders();
  log(JSON.stringify({
    ...headers,
    Authorization: headers.Authorization?.slice(0, 30) + '...'
  }, null, 2));

  // Fetch QuickBooks settings from Frappe
  const rawSettings = await frappe.getDoc<QuickBooksSettings>('QuickBooks Settings', 'QuickBooks Settings');
  const settings = fromFrappe(rawSettings);
  log(JSON.stringify(settings, null, 2));

  // Ensure realmId is present
  if (!settings.realmId) {
    throw new Error('❌ realmId missing from QuickBooks Settings.');
  }

  // Fetch QBO item details
  const getUrl = `${baseUrl}/item/${item.custom_qbo_item_id}`;
  const { data: getRes } = await axios.get<QboItemResponse>(getUrl, { headers });

  const qboItem = getRes.Item;
  if (!qboItem?.SyncToken) {
    log(`❌ QBO item missing SyncToken — cannot update.`);
    return;
  }

  // Build update payload for QBO
  const updatePayload = {
    ...qboItem,
    PurchaseCost: newCost,
    sparse: true,
  };

  // Send update request to QBO
  const postUrl = `${baseUrl}/item?operation=update`;
  log(JSON.stringify(updatePayload, null, 2));

  const updateRes = await axios.post(postUrl, updatePayload, { headers });

  // Log result
  if (updateRes.status >= 200 && updateRes.status < 300) {
    log(`✅ QBO cost updated for '${item.name}' to ${newCost}`);
  } else {
    log(`❌ QBO update failed with status: ${updateRes.status}`);
  }
}

// Run main function and handle errors
main().catch((err) => {
  log('❌ Exception during QBO cost update:', {
    exc_type: err?.name,
    message: err?.message,
    data: err?.response?.data,
  });
});
