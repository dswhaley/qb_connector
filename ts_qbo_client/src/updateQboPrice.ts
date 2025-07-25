// Imports for Frappe API, QBO authentication, HTTP requests, and date handling
import { frappe } from './frappe';
import { getQboAuthHeaders, getQboBaseUrl } from './auth';
import axios from 'axios';
import dayjs from 'dayjs';

// Type for QBO Item
interface QboItem {
  Id: string;
  Name: string;
  UnitPrice?: number;
  PurchaseCost?: number;
  SyncToken?: string;
}

// Type for QBO Item API response
interface QboItemResponse {
  Item: QboItem;
}

// Type for Frappe Item Price
interface ItemPrice {
  price_list_rate: number;
}

// Main function to update the price of a QBO item from ERPNext
async function main() {
  console.log('✅ updateQboPrice.ts started');

  // Get item name and new price from command line arguments
  const itemName = process.argv[2];
  const newPrice = process.argv[3];
  if (!itemName) {
    console.error('❌ No item name provided.');
    process.exit(1);
  }

  // Fetch item from Frappe
  const item = await frappe.getDoc<any>('Item', itemName);

  // Fetch selling price for the item from Frappe
  const prices: ItemPrice[] = await frappe.getAllFiltered<ItemPrice>('Item Price', {
    filters: { item_code: item.name, selling: 1 },
    fields: ['price_list_rate']
  });

  // Ensure item has QBO ID and selling price
  if (!item.custom_qbo_item_id || prices.length === 0) {
    console.log(`ℹ️ Skipping item '${item.name}' — No QBO ID or selling price found.`);
    return;
  }

  // Get QBO API base URL and auth headers
  const baseUrl = await getQboBaseUrl();
  const headers = await getQboAuthHeaders();

  // Fetch QBO item details
  const getUrl = `${baseUrl}/item/${item.custom_qbo_item_id}`;
  const { data: getRes } = await axios.get<QboItemResponse>(getUrl, { headers });
  const qboItem = getRes.Item;

  // Ensure QBO item has SyncToken for update
  if (!qboItem?.SyncToken) {
    console.error(`❌ QBO item missing SyncToken — cannot update.`);
    return;
  }

  // Build update payload for QBO
  const updatePayload = {
    ...qboItem,
    UnitPrice: newPrice,
    sparse: true
  };

  // Send update request to QBO
  const postUrl = `${baseUrl}/item?operation=update`;
  const updateRes = await axios.post(postUrl, updatePayload, { headers });

  // Log result
  if (updateRes.status >= 200 && updateRes.status < 300) {
    console.log(`💲 Updated QBO price for '${item.name}' to ${newPrice}`);
  } else {
    console.error(`❌ QBO update failed with status: ${updateRes.status}`);
  }
}

// Run main function and handle errors
main().catch((err) => {
  console.error(`❌ Failed to update QBO price:`, err?.response?.data || err.message);
});
