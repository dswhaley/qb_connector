import { getQboAuthHeaders, getQboBaseUrl } from "./auth"; // QBO authentication helpers
import { frappe } from "./frappe"; // Frappe API integration
import axios from "axios"; // HTTP client for API requests
import dotenv from "dotenv"; // Loads environment variables
dotenv.config(); // Initialize environment variables

const salesTaxID = process.env.SALES_TAX_ID; // QBO Sales Tax Code ID
const discountID = process.env.DISCOUNT_ID; // QBO Discount Account ID

// Type for QBO invoice response
interface QboInvoiceResponse {
  Invoice?: {
    Id: string;
    [key: string]: any;
  };
}

// Main function to sync a Sales Invoice from ERPNext to QuickBooks Online
async function main() {
  // Get invoice name from command line argument
  const invoiceName = process.argv[2];
  if (!invoiceName) {
    console.error("❌ No Sales Invoice name provided.");
    process.exit(1);
  }

  try {
    // Fetch invoice and customer data from Frappe
    const invoice = await frappe.getDoc<any>("Sales Invoice", invoiceName);
    const customer = await frappe.getDoc<any>("Customer", invoice.customer);

    // Determine state taxability for the customer
    const state = customer.custom_state;
    const stateTaxability = await getStateTaxability(state);

    // Ensure customer has a QBO ID
    if (!customer.custom_qbo_customer_id) {
      throw new Error(`❌ Customer ${customer.name} has no QBO ID.`);
    }

    // Get QBO API base URL and auth headers
    const baseUrl = await getQboBaseUrl();
    const headers = await getQboAuthHeaders();

    // Discount account IDs from environment
    const taxedDiscountID = process.env.TAXED_DISCOUNT_ID;
    const nonTaxedDiscountID = process.env.NON_TAXED_DISCOUNT_ID

    if (!taxedDiscountID) {
      throw new Error("❌ DISCOUNT_ID is not set in .env");
    }
    if (!nonTaxedDiscountID) {
      throw new Error("❌ DISCOUNT_ID is not set in .env");
    }

    // Build QBO line items from invoice items
    const lineItems = [];
    let taxedDiscountAmount: number = 0;
    let nonTaxedDiscountAmount: number = 0;
    const discountPercentage = parseFloat(invoice.additional_discount_percentage || 0);

    for (const line of invoice.items) {
      // Fetch item details from Frappe
      const item = await frappe.getDoc<any>("Item", line.item_code);

      // Skip items without QBO item ID
      if (!item.custom_qbo_item_id) {
        console.warn(`⚠️ Skipping item '${item.name}' — No QBO item ID.`);
        continue;
      }

      // Get item price from Frappe
      const prices = await frappe.getAllFiltered<any>("Item Price", {
        filters: {
          item_code: item.name,
          selling: 1,
        },
        limit: 1,
      });

      // Determine unit price
      const unitPrice = prices.length && prices[0].price_list_rate !== undefined
        ? prices[0].price_list_rate
        : line.rate || line.amount / line.qty || 0;

      // Calculate item amount
      const amount = line.amount || line.rate * line.qty || 0;
      if (amount <= 0) {
        console.warn(`⚠️ Skipping item '${item.name}' due to invalid amount.`);
        continue;
      }
      
      // Assign tax code and accumulate discount amounts
      if(stateTaxability){
        let taxCode;
        if(item.custom_tax_category === "Taxable"){
          taxCode = "TAX";
          taxedDiscountAmount += amount * (discountPercentage / 100);
        } else {
          nonTaxedDiscountAmount += amount * (discountPercentage / 100);
          taxCode = "NON";
        }
        lineItems.push({
          DetailType: "SalesItemLineDetail",
          Amount: line.amount,
          SalesItemLineDetail: {
            ItemRef: { value: item.custom_qbo_item_id },
            Qty: line.qty,
            UnitPrice: unitPrice,
            TaxCodeRef: {value: taxCode},
          },
          Description: line.description || item.description || undefined,
        });
      } else {
        nonTaxedDiscountAmount += amount * (discountPercentage / 100);
        lineItems.push({
          DetailType: "SalesItemLineDetail",
          Amount: line.amount,
          SalesItemLineDetail: {
            ItemRef: { value: item.custom_qbo_item_id },
            Qty: line.qty,
            UnitPrice: unitPrice,
            TaxCodeRef: {value: "NON"},
          },
          Description: line.description || item.description || undefined,
        });
      }
    }
    
    // Add discount line if applicable
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

    // Optionally add taxed/non-taxed discount lines (currently commented out)
    // if (taxedDiscountAmount > 0) {
    //   lineItems.push({
    //     DetailType: "SalesItemLineDetail",
    //     Amount: -taxedDiscountAmount,
    //     SalesItemLineDetail: {
    //       ItemRef: { value: taxedDiscountID},
    //       Qty: 1,
    //       UnitPrice: -taxedDiscountAmount,
    //     },
    //     Description: `Disount amount is ${taxedDiscountAmount}`,
    //   });
    // }

    // if(nonTaxedDiscountAmount > 0){
    //   lineItems.push({
    //     DetailType: "SalesItemLineDetail",
    //     Amount: -nonTaxedDiscountAmount,
    //     SalesItemLineDetail: {
    //       ItemRef: { value: nonTaxedDiscountID},
    //       Qty: 1,
    //       UnitPrice: -nonTaxedDiscountAmount,
    //     },
    //     Description: `Disount amount is ${nonTaxedDiscountAmount}`,
    //   });      
    // }

    // Ensure there are valid line items to sync
    if (lineItems.length === 0) {
      throw new Error("❌ No valid QBO items to sync.");
    }

    // Build shipping address from customer fields
    const street1 = customer.custom_street_address_line_1;
    const street2 = customer.custom_street_address_line_2;
    const city = customer.custom_city;
    const stateCode = customer.custom_state;
    const postalCode = customer.custom_zip_code;
    const country = customer.custom_country;

    // Construct QBO invoice payload
    const qboInvoice: any = {
      CustomerRef: { value: customer.custom_qbo_customer_id },
      Line: lineItems,
      TxnDate: invoice.posting_date,
      DueDate: invoice.due_date || undefined,
      ApplyTaxAfterDiscount: true,
      ShipAddr: {
        Line1: street1,
        Line2: street2,
        City: city,
        CountrySubDivisionCode: stateCode,
        PostalCode: postalCode,
        Country: country
      },
    };
    // Add tax details if invoice is not exempt
    if (!invoice.exempt_from_sales_tax) {
      qboInvoice.TxnTaxDetail = {
        TxnTaxCodeRef: { value: salesTaxID },
      };
      qboInvoice.GlobalTaxCalculation = "TaxExcluded";
    } else {
      qboInvoice.GlobalTaxCalculation = "NotApplicable";
    }

    // Send invoice to QBO via API
    const response = await axios.post(`${baseUrl}/invoice`, qboInvoice, { headers });
    const resData = response.data as QboInvoiceResponse;

    // Handle QBO response
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
    // Error handling for sync failures
    console.error("❌ Exception during invoice sync:", err.message || err);

    if (err.response?.data) {
      console.error("❗ QBO Error Response:", JSON.stringify(err.response.data, null, 2));
    }

    process.exitCode = -1; // Failure
  }
}


// Helper function to determine if a state is taxable
async function getStateTaxability(state: string) {
  try {
    // Fetch the State Tax Information document (assuming it's a singleton)
    const stateInfo = await frappe.getDoc<any>("State Tax Information", "State Tax Information");
    
    // Convert the state to lowercase to handle case insensitivity
    state = state.toLowerCase();
    
    // Dynamically check if the checkbox corresponding to the state exists
    const fieldName = state.toLowerCase();  // Example: "california" becomes "california"
    
    // Check if the field exists in the document and return its value
    if (stateInfo.hasOwnProperty(fieldName)) {
      const isTaxable = stateInfo[fieldName];  // Will be true if checkbox is checked, false otherwise
      return isTaxable;  // Return true or false
    } else {
      return false;  // If the field doesn't exist, return false
    }
  } catch (error) {
    console.error("Error fetching State Tax Information:", error);
    return null;  // In case of any error
  }
}



// Run main function
main();
