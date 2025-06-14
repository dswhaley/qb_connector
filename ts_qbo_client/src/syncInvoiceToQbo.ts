import { getQboAuthHeaders, getQboBaseUrl } from "./auth";
import { frappe } from "./frappe";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

interface QboInvoiceResponse {
  Invoice?: {
    Id: string;
    [key: string]: any;
  };
}
const salesTaxID = process.env.SALES_TAX_ID;

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

    const discountID = process.env.DISCOUNT_ID;

    if (!discountID) {
      throw new Error("❌ DISCOUNT_ID is not set in .env");
    }

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

      const unitPrice = prices.length && prices[0].price_list_rate !== undefined
        ? prices[0].price_list_rate
        : line.rate || line.amount / line.qty || 0;

      
      // Map ERPNext custom_tax_category to QBO TaxCodeRef
      const taxCode = item.custom_tax_category === "Taxable" ? "TAX" : "NON";
      if (!["Taxable", "Not Taxable"].includes(item.custom_tax_category)) {
        console.warn(`⚠️ Invalid custom_tax_category '${item.custom_tax_category}' for item '${item.name}'. Defaulting to NON.`);
      }
      

      lineItems.push({
        DetailType: "SalesItemLineDetail",
        Amount: line.amount,
        SalesItemLineDetail: {
          ItemRef: { value: item.custom_qbo_item_id },
          Qty: line.qty,
          UnitPrice: unitPrice,
          TaxCodeRef: { value: taxCode },
        },
        Description: line.description || item.description || undefined,
      });
    }

    const discountPercent = parseFloat(invoice.additional_discount_percentage || "0");
    if (discountPercent > 0) {
      lineItems.push({
        DetailType: "DiscountLineDetail",
        DiscountLineDetail: {
          PercentBased: true,
          DiscountPercent: discountPercent,
          DiscountAccountRef: { value: discountID, name: "Discounts given" },
        },
        Description: `ERPNext Additional Discount: ${discountPercent.toFixed(2)}%`,
      });
    }

    if (lineItems.length === 0) {
      throw new Error("❌ No valid QBO items to sync.");
    }

    const qboInvoice: any = {
      CustomerRef: { value: customer.custom_qbo_customer_id },
      Line: lineItems,
      TxnDate: invoice.posting_date,
      DueDate: invoice.due_date || undefined,
    };

    if (!invoice.exempt_from_sales_tax) {
      qboInvoice.TxnTaxDetail = {
        TxnTaxCodeRef: { value: salesTaxID },
      };
      qboInvoice.GlobalTaxCalculation = "TaxExcluded";
    } else {
      qboInvoice.GlobalTaxCalculation = "NotApplicable";
    }


    console.log("📝 QBO Invoice Payload:");
    console.dir(qboInvoice, { depth: null });

    const response = await axios.post(`${baseUrl}/invoice`, qboInvoice, { headers });
    const resData = response.data as QboInvoiceResponse;

    if (response.status === 200 || response.status === 201) {
      console.log(`✅ Synced invoice ${invoice.name} to QBO (Id: ${resData.Invoice?.Id})`);
      process.exit(0);
    } else {
      console.error(`❌ Failed to sync invoice: Status ${response.status}, Data: ${JSON.stringify(response.data, null, 2)}`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`❌ Exception during invoice sync: ${err.message}`);
    if (err.response) {
      console.error("QBO API Error Details:", JSON.stringify(err.response.data, null, 2));
    }
    process.exit(1);
  }
}

main();