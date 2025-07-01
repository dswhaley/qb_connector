import axios from 'axios';
import { frappe } from './frappe';
import { fromFrappe } from './sync/mappers';
import { QuickBooksSettings } from './types';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

interface QboItem {
  Id: string;
  Name: string;
  Description?: string;
  Type: 'Inventory' | 'Service' | 'NonInventory' | string;
  Active: boolean;
  UnitPrice?: number;
  PurchaseCost?: number;
  Taxable?: boolean;
  MetaData?: {
    LastUpdatedTime?: string;
    CreateTime?: string;
  };
}

interface QboItemResponse {
  QueryResponse: {
    Item?: QboItem[];
  };
}

export async function syncItemsFromQbo(): Promise<void> {
  const rawSettings = await frappe.getDoc<any>('QuickBooks Settings', 'QuickBooks Settings');
  const settings = fromFrappe(rawSettings);

  const realmId = settings.realmId;
  const baseUrl =
    process.env.QBO_ENV === 'production'
      ? 'https://quickbooks.api.intuit.com/v3/company'
      : 'https://sandbox-quickbooks.api.intuit.com/v3/company';

  const headers = {
    Authorization: `Bearer ${settings.accessToken}`,
    Accept: 'application/json',
  };

  const response = await axios.get<QboItemResponse>(`${baseUrl}/${realmId}/query`, {
    params: {
      query: 'SELECT * FROM Item WHERE Active = true',
      maxResults: 1000,
    },
    headers,
  });

  const qboItems: QboItem[] = response.data.QueryResponse.Item || [];

  for (const item of qboItems) {
    try {
      const itemCode = item.Name.trim();
      const isStockItem = item.Type === 'Inventory' ? 1 : 0;
      const standardRate = item.UnitPrice || 0;
      const valuationRate = item.PurchaseCost || item.UnitPrice || 0;
      const now = dayjs().tz('America/New_York').format('YYYY-MM-DD HH:mm:ss');
      const itemGroupName = item.Type || 'Uncategorized';

      const existingGroups = await frappe.getAllFiltered('Item Group', {
        filters: { item_group_name: itemGroupName },
        fields: ['name'],
      });

      if (!existingGroups.length) {
        console.log(`📁 Creating missing Item Group: ${itemGroupName}`);
        await frappe.createDoc('Item Group', {
          item_group_name: itemGroupName,
          is_group: 0,
          parent_item_group: 'All Item Groups',
        });
      }

      const taxTemplate = item.Taxable
        ? "MD Sales Tax - Taxable - F"
        : "MD Sales Tax - Not Taxable - F";

      // Check if item already exists
      const existingItems = await frappe.getAllFiltered('Item', {
        filters: {
          custom_qbo_item_id: item.Id,
        },
        fields: ['name'],
      });

      if (existingItems.length > 0) {
        console.log(`🔁 Skipping '${itemCode}': already exists in Frappe as '${existingItems[0].name}'`);
        continue;
      }

      const docPayload = {
        item_code: itemCode,
        item_name: itemCode,
        description: item.Description || '',
        is_stock_item: isStockItem,
        stock_uom: 'Nos',
        standard_rate: standardRate,
        valuation_rate: valuationRate,
        disabled: item.Active === false ? 1 : 0,
        item_group: itemGroupName,
        custom_qbo_item_id: item.Id,
        custom_qbo_type: item.Type,
        custom_qbo_last_synced_at: now,
        custom_skip_qbo_sync: 1,
        custom_tax_category: item.Taxable ? 'Taxable' : 'Not Taxable',
      };

      console.log(`📌 Creating Item '${itemCode}' with tax_category = ${docPayload.custom_tax_category}`);
      await frappe.createDoc('Item', docPayload);
      console.log(`✅ Created Item '${itemCode}' from QBO`);

      const existingPrice = await frappe.getAllFiltered('Item Price', {
        filters: {
          item_code: itemCode,
          price_list: 'Standard Selling',
        },
        fields: ['name'],
      });

      if (!existingPrice.length) {
        await frappe.createDoc('Item Price', {
          item_code: itemCode,
          price_list: 'Standard Selling',
          selling: 1,
          price_list_rate: standardRate,
        });
        console.log(`💲 Added selling price for '${itemCode}'`);
      } else {
        console.log(`ℹ️  Skipped price for '${itemCode}' (already exists)`);
      }
    } catch (error: any) {
      console.error(`❌ Failed to sync QBO item '${item.Name}':`, error.response?.data || error.message);
    }
  }
}

if (require.main === module) {
  syncItemsFromQbo()
    .then(() => console.log("🎉 Finished syncing all QBO items."))
    .catch((err) => console.error("❌ Top-level error:", err));
}