import { frappe } from './frappe';
import { getQboAuthHeaders, getQboBaseUrl } from './auth';
import { fromFrappe } from './sync/mappers';
import { QuickBooksSettings } from './types';
import axios from 'axios';
import dayjs from 'dayjs';

interface QboItem {
  Id: string;
  Name: string;
  SyncToken: string;
  UnitPrice?: number;
  PurchaseCost?: number;
}

interface QboItemResponse {
  Item: QboItem;
}

function isFilled(val: any): boolean {
  return typeof val === 'string' ? val.trim().length > 0 : val !== undefined && val !== null;
}

function log(msg: string, obj?: any) {
  process.stdout.write(`${msg}\n`);
  if (obj !== undefined) {
    process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  }
}

async function main() {

  const itemName = process.argv[2];
  const newCost = parseFloat(process.argv[3]);
  if (!isFilled(itemName)) {
    process.exit(1);
  }

  const item = await frappe.getDoc<any>('Item', itemName);

  if (!item.custom_qbo_item_id || !item.valuation_rate) {
    log(`ℹ️ Skipping item '${item.name}' — No QBO ID or valuation rate.`);
    return;
  }

  const baseUrl = await getQboBaseUrl();

  const headers = await getQboAuthHeaders();
  log(JSON.stringify({
    ...headers,
    Authorization: headers.Authorization?.slice(0, 30) + '...'
  }, null, 2));

  const rawSettings = await frappe.getDoc<QuickBooksSettings>('QuickBooks Settings', 'QuickBooks Settings');
  const settings = fromFrappe(rawSettings);
  log(JSON.stringify(settings, null, 2));

  if (!settings.realmId) {
    throw new Error('❌ realmId missing from QuickBooks Settings.');
  }

  const getUrl = `${baseUrl}/item/${item.custom_qbo_item_id}`;

  const { data: getRes } = await axios.get<QboItemResponse>(getUrl, { headers });

  const qboItem = getRes.Item;
  if (!qboItem?.SyncToken) {
    log(`❌ QBO item missing SyncToken — cannot update.`);
    return;
  }
  const updatePayload = {
    ...qboItem,
    PurchaseCost: newCost,
    sparse: true,
  };

  const postUrl = `${baseUrl}/item?operation=update`;
  log(JSON.stringify(updatePayload, null, 2));

  const updateRes = await axios.post(postUrl, updatePayload, { headers });

  if (updateRes.status >= 200 && updateRes.status < 300) {
    log(`✅ QBO cost updated for '${item.name}' to ${newCost}`);

  } else {
    log(`❌ QBO update failed with status: ${updateRes.status}`);
  }
}

main().catch((err) => {
    log('❌ Exception during QBO cost update:', {
    exc_type: err?.name,
    message: err?.message,
    data: err?.response?.data,
    });
});
