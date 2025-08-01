// Imports for QBO authentication, Frappe API, HTTP requests, environment, file system, and process execution
import { getQboAuthHeaders, getQboBaseUrl } from "./auth";
import { frappe } from "./frappe";
import axios from "axios";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";

// Load environment variables from .env file
dotenv.config();

// Type for QBO Payment API response
interface QboPaymentResponse {
  Payment?: {
    Id: string;
    [key: string]: any;
  };
}

// Helper to ensure required mapping files exist, generating them if missing
function ensureFileExists(filePath: string, generatorScriptPath: string) {
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️ ${path.basename(filePath)} not found. Running ${generatorScriptPath}...`);
    try {
      execSync(`npx ts-node "${generatorScriptPath}"`, { stdio: "inherit" });
    } catch (err) {
      throw new Error(`❌ Failed to run ${generatorScriptPath}`);
    }
    if (!fs.existsSync(filePath)) {
      throw new Error(`❌ ${path.basename(filePath)} was not created by ${generatorScriptPath}`);
    }
  }
}

// Main function to sync a Payment Entry from ERPNext to QuickBooks Online
async function main() {
  // Get Payment Entry name from command line argument
  const paymentEntryName = process.argv[2];
  if (!paymentEntryName) {
    console.error("❌ No Payment Entry name provided.");
    process.exit(1);
  }

  try {
    // Prepare paths for mapping files and generator scripts
    const idScriptsDir = path.resolve(__dirname, "QBO_ID_Scripts");

    const paymentMethodMapPath = path.join(idScriptsDir, "payment_method_map.json");
    const accountIdMapPath = path.join(idScriptsDir, "account_id_map.json");

    const getPaymentMethodsScript = path.join(idScriptsDir, "get_payment_methods.ts");
    const fetchAccountsScript = path.join(idScriptsDir, "fetchAccounts.ts");

    // Ensure mapping files exist, generate if missing
    ensureFileExists(paymentMethodMapPath, getPaymentMethodsScript);
    ensureFileExists(accountIdMapPath, fetchAccountsScript);

    // Load mapping files
    const paymentMethodMap: Record<string, string> = JSON.parse(fs.readFileSync(paymentMethodMapPath, "utf8"));
    const accountIdMap: Record<string, string> = JSON.parse(fs.readFileSync(accountIdMapPath, "utf8"));

    // Fetch Payment Entry and Customer from Frappe
    const paymentEntry = await frappe.getDoc<any>("Payment Entry", paymentEntryName);
    const customer = await frappe.getDoc<any>("Customer", paymentEntry.party);

    // Ensure customer has a QBO ID
    if (!customer.custom_qbo_customer_id) {
      throw new Error(`❌ Customer ${customer.name} has no QBO ID.`);
    }

    // Get QBO API base URL and auth headers
    const baseUrl = await getQboBaseUrl();
    const headers = await getQboAuthHeaders();

    // Build QBO payment line items
    const lineItems: any[] = [];

    if (Array.isArray(paymentEntry.references)) {
      for (const ref of paymentEntry.references) {
        if (ref.reference_doctype === "Sales Invoice" && ref.reference_name) {
          // Link payment to QBO Sales Invoice if available
          const linkedInvoice = await frappe.getDoc<any>("Sales Invoice", ref.reference_name);
          if (linkedInvoice?.custom_qbo_sales_invoice_id) {
            lineItems.push({
              Amount: ref.allocated_amount || paymentEntry.paid_amount,
              LinkedTxn: [
                {
                  TxnId: linkedInvoice.custom_qbo_sales_invoice_id,
                  TxnType: "Invoice",
                },
              ],
            });
          } else {
            console.warn(`⚠️ No valid QBO Sales Invoice ID for ${ref.reference_name}`);
          }
        }
      }
    }

    // If no references, add a generic payment line
    if (lineItems.length === 0) {
      lineItems.push({
        Amount: paymentEntry.paid_amount,
        Description: paymentEntry.remarks || `Payment ${paymentEntry.name}`,
      });
    }

    // Get payment method and deposit account IDs from mapping files
    const mode = paymentEntry.mode_of_payment;
    const paymentMethodId = paymentMethodMap[mode];
    if (!paymentMethodId) {
      throw new Error(`❌ Invalid mode_of_payment: "${mode}" not found in payment_method_map.json`);
    }

    const depositAccountName = process.env.QBO_DEPOSIT_ACCOUNT_NAME;
    if (!depositAccountName) {
      throw new Error("❌ QBO_DEPOSIT_ACCOUNT_NAME not set in .env");
    }

    const depositAccountId = accountIdMap[depositAccountName];
    if (!depositAccountId) {
      throw new Error(`❌ Deposit account "${depositAccountName}" not found in account_id_map.json`);
    }

    // Build QBO Payment payload
    const qboPayment = {
      CustomerRef: { value: customer.custom_qbo_customer_id },
      TotalAmt: paymentEntry.paid_amount,
      TxnDate: paymentEntry.posting_date,
      PaymentMethodRef: { value: paymentMethodId },
      DepositToAccountRef: { value: depositAccountId },
      Line: lineItems,
    };

    // Log payload for debugging
    console.log("📝 QBO Payment Payload:");
    console.dir(qboPayment, { depth: null });

    // Send payment to QBO via API
    const response = await axios.post(`${baseUrl}/payment`, qboPayment, { headers });
    const resData = response.data as QboPaymentResponse;

    // Handle QBO response
    if ((response.status === 200 || response.status === 201) && resData.Payment && resData.Payment.Id) {
      console.log(resData.Payment.Id); // ✅ Output the ID safely
      process.exit(0);                 // ✅ Success exit
    } else {
      console.error(`❌ Failed to sync payment: Status ${response.status}`);
      console.error(JSON.stringify(response.data, null, 2));
      process.exit(1);                 // ❌ Failure exit
    }
  } catch (err: any) {
    // Error handling for sync failures
    console.error(`❌ Exception during payment sync: ${err.message}`);
    if (err.response?.data) {
      console.error("QBO API Error:", JSON.stringify(err.response.data, null, 2));
    }
    process.exit(1);
  }
}

// Run main function
main();
