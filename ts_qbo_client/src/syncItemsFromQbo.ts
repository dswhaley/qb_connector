// Imports for HTTP requests, Frappe API, type mapping, and date/time handling
import axios from 'axios';
import { frappe } from './frappe';
import { fromFrappe } from './sync/mappers';
import { QuickBooksSettings } from './types';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

// Extend dayjs with UTC and timezone plugins
dayjs.extend(utc);
dayjs.extend(timezone);

// Type for QBO Item
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

// Type for QBO Item API response
interface QboItemResponse {
  QueryResponse: {
    Item?: QboItem[];
  };
}

// Main function to sync items from QBO to Frappe
export async function syncItemsFromQbo(): Promise<void> {
  // Fetch QuickBooks settings from Frappe
  const rawSettings = await frappe.getDoc<any>('QuickBooks Settings', 'QuickBooks Settings');
  const settings = fromFrappe(rawSettings);

  // Get QBO realm ID and base URL depending on environment
  const realmId = settings.realmId;
  const baseUrl =
    process.env.QBO_ENV === 'production'
      ? 'https://quickbooks.api.intuit.com/v3/company'
      : 'https://sandbox-quickbooks.api.intuit.com/v3/company';

  // Prepare QBO API headers
  const headers = {
    Authorization: `Bearer ${settings.accessToken}`,
    Accept: 'application/json',
  };

  // Fetch active items from QBO
  const response = await axios.get<QboItemResponse>(`${baseUrl}/${realmId}/query`, {
    params: {
      query: 'SELECT * FROM Item WHERE Active = true',
      maxResults: 1000,
    },
    headers,
  });

  const qboItems: QboItem[] = response.data.QueryResponse.Item || [];

  // Iterate over each QBO item and sync to Frappe
  for (const item of qboItems) {
    try {
      // Prepare item fields for Frappe
      const itemCode = item.Name.trim();
      const isStockItem = item.Type === 'Inventory' ? 1 : 0;
      const standardRate = item.UnitPrice || 0;
      const valuationRate = item.PurchaseCost || item.UnitPrice || 0;
      const now = dayjs().tz('America/New_York').format('YYYY-MM-DD HH:mm:ss');
      const itemGroupName = item.Type || 'Uncategorized';

      // Ensure item group exists in Frappe
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

      // Set tax template based on QBO item taxability
      const taxTemplate = item.Taxable
        ? "MD Sales Tax - Taxable - F"
        : "MD Sales Tax - Not Taxable - F";

      // Check if item already exists in Frappe
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

      // Build payload for new Frappe Item
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

      // Create new Item in Frappe
      console.log(`📌 Creating Item '${itemCode}' with tax_category = ${docPayload.custom_tax_category}`);
      await frappe.createDoc('Item', docPayload);
      console.log(`✅ Created Item '${itemCode}' from QBO`);

      // Ensure selling price exists for the item
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
      // Error handling for item sync failures
      console.error(`❌ Failed to sync QBO item '${item.Name}':`, error.response?.data || error.message);
    }
  }
}

// Run syncItemsFromQbo if this file is executed directly
if (require.main === module) {
  syncItemsFromQbo()
    .then(() => console.log("🎉 Finished syncing all QBO items."))
    .catch((err) => console.error("❌ Top-level error:", err));
}