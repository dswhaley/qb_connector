// src/syncInvoiceToQbo.ts

import { getQboAuthHeaders, getQboBaseUrl } from "./auth";
import { frappe } from "./frappe";
import axios from "axios";

interface QboInvoiceResponse {
  Invoice?: {
    Id: string;
    [key: string]: any;
  };
}

async function main() {
  const invoiceName = process.argv[2];
  if (!invoiceName) {
    console.error("❌ No Sales Invoice name provided.");
    process.exit(1);
  }

  try {
    const invoice = await frappe.getDoc<any>("Sales Invoice", invoiceName);
    const customer = await frappe.getDoc<any>("Customer", invoice.customer);

    if (!customer.custom_qbo_customer_id) {
      throw new Error(`❌ Customer ${customer.name} has no QBO ID.`);
    }

    const baseUrl = await getQboBaseUrl();
    const headers = await getQboAuthHeaders();

    const lineItems = [];
    for (const line of invoice.items) {
      const item = await frappe.getDoc<any>("Item", line.item_code);

      if (!item.custom_qbo_item_id) {
        console.warn(`⚠️ Skipping item '${item.name}' — No QBO item ID.`);
        continue;
      }

      const prices = await frappe.getAllFiltered<any>("Item Price", {
        filters: {
          item_code: item.name,
          selling: 1,
        },
        limit: 1,
      });

      const unitPrice = prices.length ? prices[0].price_list_rate : line.rate;

      lineItems.push({
        DetailType: "SalesItemLineDetail",
        Amount: line.amount,
        SalesItemLineDetail: {
          ItemRef: { value: item.custom_qbo_item_id },
          Qty: line.qty,
          UnitPrice: unitPrice,
        },
        Description: line.description || item.description || undefined,
      });
    }

    if (lineItems.length === 0) {
      throw new Error("❌ No valid QBO items to sync.");
    }

    const qboInvoice = {
      CustomerRef: { value: customer.custom_qbo_customer_id },
      Line: lineItems,
      BillEmail: customer.email_id ? { Address: customer.email_id } : undefined,
      TxnDate: invoice.posting_date,
      DueDate: invoice.due_date || undefined,
    };

    const response = await axios.post(`${baseUrl}/invoice`, qboInvoice, { headers });

    const resData = response.data as QboInvoiceResponse;

    if (response.status === 200 || response.status === 201) {
      console.log(`✅ Synced invoice ${invoice.name} to QBO (Id: ${resData.Invoice?.Id})`);
      process.exit(0);
    } else {
      console.error(`❌ Failed to sync invoice: ${response.status}`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`❌ Exception during invoice sync: ${err.message}`);
    process.exit(1);
  }
}

main();
