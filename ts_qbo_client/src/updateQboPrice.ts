import { frappe } from './frappe';
import { getQboAuthHeaders, getQboBaseUrl } from './auth';
import axios from 'axios';
import dayjs from 'dayjs';

interface QboItem {
  Id: string;
  Name: string;
  UnitPrice?: number;
  PurchaseCost?: number;
  SyncToken?: string;
}

interface QboItemResponse {
  Item: QboItem;
}

interface ItemPrice {
  price_list_rate: number;
}

async function main() {
  console.log('✅ updateQboPrice.ts started');

  const itemName = process.argv[2];
  const newPrice = process.argv[3];
  if (!itemName) {
    console.error('❌ No item name provided.');
    process.exit(1);
  }

  const item = await frappe.getDoc<any>('Item', itemName);

  const prices: ItemPrice[] = await frappe.getAllFiltered<ItemPrice>('Item Price', {
    filters: { item_code: item.name, selling: 1 },
    fields: ['price_list_rate']
  });

  if (!item.custom_qbo_item_id || prices.length === 0) {
    console.log(`ℹ️ Skipping item '${item.name}' — No QBO ID or selling price found.`);
    return;
  }

  const baseUrl = await getQboBaseUrl();
  const headers = await getQboAuthHeaders();

  const getUrl = `${baseUrl}/item/${item.custom_qbo_item_id}`;

  const { data: getRes } = await axios.get<QboItemResponse>(getUrl, { headers });
  const qboItem = getRes.Item;

  if (!qboItem?.SyncToken) {
    console.error(`❌ QBO item missing SyncToken — cannot update.`);
    return;
  }

  const updatePayload = {
    ...qboItem,
    UnitPrice: newPrice,
    sparse: true
  };

  const postUrl = `${baseUrl}/item?operation=update`;

  const updateRes = await axios.post(postUrl, updatePayload, { headers });

  if (updateRes.status >= 200 && updateRes.status < 300) {
    console.log(`💲 Updated QBO price for '${item.name}' to ${newPrice}`);

  } else {
    console.error(`❌ QBO update failed with status: ${updateRes.status}`);
  }
}

main().catch((err) => {
  console.error(`❌ Failed to update QBO price:`, err?.response?.data || err.message);
});
