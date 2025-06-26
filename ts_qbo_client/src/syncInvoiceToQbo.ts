import { getQboAuthHeaders, getQboBaseUrl } from "./auth";
import { frappe } from "./frappe";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const salesTaxID = process.env.SALES_TAX_ID;

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

    const taxedDiscountID = process.env.TAXED_DISCOUNT_ID;
    const nonTaxedDiscountID = process.env.NON_TAXED_DISCOUNT_ID

    if (!taxedDiscountID) {
      throw new Error("❌ DISCOUNT_ID is not set in .env");
    }
    if (!nonTaxedDiscountID) {
      throw new Error("❌ DISCOUNT_ID is not set in .env");
    }


    const lineItems = [];
    let taxedDiscountAmount: number = 0;
    let nonTaxedDiscountAmount: number = 0;
    const discountPercentage = parseFloat(invoice.additional_discount_percentage || 0);

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

      const amount = line.amount || line.rate * line.qty || 0;
      if (amount <= 0) {
        console.warn(`⚠️ Skipping item '${item.name}' due to invalid amount.`);
        continue;
      }

      const taxCode = item.custom_tax_category === "Taxable" ? "TAX" : "NON";
      if(taxCode === "TAX"){
        taxedDiscountAmount +=amount * (discountPercentage / 100);
      } else {
        nonTaxedDiscountAmount += line.amount * (discountPercentage / 100);
      }
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


    if (taxedDiscountAmount > 0) {
      lineItems.push({
        DetailType: "SalesItemLineDetail",
        Amount: -taxedDiscountAmount,
        SalesItemLineDetail: {
          ItemRef: { value: taxedDiscountID},
          Qty: 1,
          UnitPrice: -taxedDiscountAmount,
          TaxCodeRef: { value: "TAX" },
        },
        Description: `Disount amount is ${taxedDiscountAmount}`,
      });
    }

    if(nonTaxedDiscountAmount > 0){
      lineItems.push({
        DetailType: "SalesItemLineDetail",
        Amount: -nonTaxedDiscountAmount,
        SalesItemLineDetail: {
          ItemRef: { value: nonTaxedDiscountID},
          Qty: 1,
          UnitPrice: -nonTaxedDiscountAmount,
          TaxCodeRef: { value: "NON" },
        },
        Description: `Disount amount is ${nonTaxedDiscountAmount}`,
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

    const response = await axios.post(`${baseUrl}/invoice`, qboInvoice, { headers });
    const resData = response.data as QboInvoiceResponse;

    if (response.status === 200 || response.status === 201) {
      if (resData.Invoice?.Id) {
        const qboId = resData.Invoice.Id;
        
        // Print ONLY the QBO Invoice ID to stdout (for Python to capture)
        console.log(qboId);  // Output the QBO Invoice ID

        process.exitCode = 0;  // Success
      } else {
        console.error("❌ QBO Invoice ID not found in the response.");
        process.exitCode = -1;  // Failure
      }
    } else {
      console.error(`❌ Failed to sync invoice: Status ${response.status}, Data: ${JSON.stringify(response.data, null, 2)}`);
      process.exitCode = -1;  // Failure
    }
  } catch (err: any) {
    console.error("❌ Exception during invoice sync:", err.message || err);

    if (err.response?.data) {
      console.error("❗ QBO Error Response:", JSON.stringify(err.response.data, null, 2));
    }

    process.exitCode = -1; // Failure
  }
}

main();
