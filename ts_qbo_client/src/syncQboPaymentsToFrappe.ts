// syncSingleQboPayment.ts
// Imports for environment variables, HTTP requests, Frappe API, and QBO authentication
import dotenv from "dotenv";
dotenv.config(); // Load environment variables

import axios from "axios";
import { frappe } from "./frappe";
import { getQboAuthHeaders, getQboBaseUrl } from "./auth";

// Type for QBO Payment
interface QboPayment {
  Id: string;
  TotalAmt: number;
  TxnDate: string;
  Line: {
    LinkedTxn?: {
      TxnId: string;
      TxnType: "Invoice";
    }[];
  }[];
}

// Type for Frappe Payment Entry payload
interface FrappePaymentEntryPayload {
  payment_type: "Receive";
  party_type: "Customer";
  party: string;
  posting_date: string;
  paid_amount: number;
  received_amount: number;
  paid_to: string;
  mode_of_payment: string;
  references: {
    reference_doctype: string;
    reference_name: string;
    allocated_amount: number;
  }[];
  custom_qbo_payment_id: string;
  custom_sync_status?: string;
  custom_dont_sync_with_qbo?: number;
}

// Type for Frappe document creation response
interface FrappeDocCreateResponse {
  name: string;
  [key: string]: any;
}

// Main function to sync a single QBO Payment to ERPNext
export async function syncSingleQboPayment(paymentId: string) {
  try {
    console.log(`🔔 Starting sync for QBO Payment ID: ${paymentId}`);

    // Get QBO API base URL and auth headers
    const baseUrl = await getQboBaseUrl();
    const headers = await getQboAuthHeaders();

    // Fetch payment details from QBO
    const url = `${baseUrl}/payment/${paymentId}`;
    console.log(`🌐 Fetching QBO Payment from: ${url}`);

    const response = await axios.get<{ Payment: QboPayment }>(url, { headers });

    const payment = response.data.Payment;
    if (!payment) {
      console.log(`⚠️ No payment found in QBO for ID: ${paymentId}`);
      return;
    }
    console.log(`✅ Found QBO Payment: ID=${paymentId}, Amount=${payment.TotalAmt}, Date=${payment.TxnDate}`);

    // Ensure payment has line items
    if (!payment.Line || payment.Line.length === 0) {
      console.log(`⚠️ Payment ID ${payment.Id} has no Line items.`);
      return;
    }

    // Iterate over each line in the payment
    for (const [lineIndex, line] of payment.Line.entries()) {
      console.log(`➡️ Processing Line ${lineIndex + 1} of Payment ${paymentId}`);

      // Skip lines without linked transactions
      if (!line.LinkedTxn || line.LinkedTxn.length === 0) {
        console.log(`⚠️ Line ${lineIndex + 1} has no linked transactions.`);
        continue;
      }

      // Iterate over each linked transaction
      for (const [txnIndex, txn] of line.LinkedTxn.entries()) {
        console.log(`  🔗 LinkedTxn ${txnIndex + 1}: TxnId=${txn.TxnId}, TxnType=${txn.TxnType}`);

        // Only process invoices
        if (txn.TxnType !== "Invoice") {
          console.log(`  ⚠️ Skipping LinkedTxn ${txnIndex + 1} as it is not an Invoice.`);
          continue;
        }

        const qboInvoiceId = txn.TxnId;

        // Find matching ERPNext Sales Invoice by custom_qbo_sales_invoice_id
        console.log(`  🔍 Searching ERPNext Sales Invoice with custom_qbo_sales_invoice_id=${qboInvoiceId}`);
        const frappeInvoices = await frappe.getAllFiltered("Sales Invoice", {
          filters: {
            custom_qbo_sales_invoice_id: qboInvoiceId,
            docstatus: 1,
          },
          fields: ["name", "customer", "outstanding_amount"],
          limit: 1,
        });

        if (frappeInvoices.length === 0) {
          console.log(`  ⚠️ No ERPNext Sales Invoice matched for QBO Invoice ID: ${qboInvoiceId}`);
          continue;
        }

        const frappeInvoice = frappeInvoices[0];
        console.log(`  ✅ Found ERPNext Sales Invoice: ${frappeInvoice.name}, Customer: ${frappeInvoice.customer}`);

        // Check if Payment Entry for this QBO payment already exists to avoid duplicates
        const existingPayments = await frappe.getAllFiltered("Payment Entry", {
          filters: {
            custom_qbo_payment_id: paymentId,
          },
          limit: 1,
        });

        if (existingPayments.length > 0) {
          console.log(`  ✅ QBO Payment ${paymentId} already synced as Payment Entry ${existingPayments[0].name}. Skipping creation.`);
          continue;
        }

        // Optional: Also check if invoice is fully paid, skip if so
        if (frappeInvoice.outstanding_amount <= 0) {
          console.log(`  ⚠️ ERPNext Sales Invoice ${frappeInvoice.name} is already fully paid. Skipping Payment Entry creation.`);
          continue;
        }

        console.log(`The Invoice name is ${frappeInvoice.name}`);

        // Build Payment Entry payload for ERPNext
        const paymentEntry: FrappePaymentEntryPayload & {
          reference_no: string;
          reference_date: string;
        } = {
          payment_type: "Receive",
          party_type: "Customer",
          party: frappeInvoice.customer,
          posting_date: payment.TxnDate,
          paid_amount: payment.TotalAmt,
          received_amount: payment.TotalAmt,
          paid_to: "Bank Account - F",  // Adjust as needed
          mode_of_payment: "Cash",       // Adjust as needed
          reference_no: paymentId,
          reference_date: payment.TxnDate,
          references: [
            {
              reference_doctype: "Sales Invoice",
              reference_name: frappeInvoice.name,
              allocated_amount: payment.TotalAmt,
            },
          ],
          custom_qbo_payment_id: paymentId,
          custom_sync_status: "Synced",
          custom_dont_sync_with_qbo: 1,
        };

        // Log payload for debugging
        console.log("  📤 Payload sent to Frappe:", JSON.stringify(paymentEntry, null, 2));

        // Create Payment Entry in ERPNext
        const created = await frappe.createDoc<FrappeDocCreateResponse>("Payment Entry", paymentEntry);

        console.log(`  📝 Created Payment Entry with name: ${created.name}`);

        // Update sync status before submitting
        created.custom_sync_status = "Synced";

        // Submit Payment Entry doc
        await frappe.submitDoc("Payment Entry", created.name);

        console.log(`  ✅ Created and submitted Payment Entry ${created.name} for Sales Invoice ${frappeInvoice.name}`);
      }
    }

    console.log(`🎉 QBO payment sync completed for Payment ID: ${paymentId}`);
  } catch (err: any) {
    // Error handling for sync failures
    console.error("❌ Error syncing payment:", err.response?.data || err.message || err);
  }
}

// Runner so you can run this file directly via ts-node
// Runner so you can run this file directly via ts-node
if (require.main === module) {
  if (process.argv.length < 3) {
    console.error("❌ Usage: ts-node syncSingleQboPayment.ts <paymentId>");
    process.exit(1);
  }
  const paymentId = process.argv[2];
  console.log(`Payment Id: ${paymentId}`)
  syncSingleQboPayment(paymentId).catch(err => {
    console.error("❌ Unhandled error in syncSingleQboPayment:", err);
    process.exit(1);
  });
}
