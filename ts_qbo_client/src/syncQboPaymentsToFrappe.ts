// import dotenv from "dotenv";
// import axios from "axios";
// import { frappe } from "./frappe";
// import { getQboAuthHeaders, getQboBaseUrl } from "./auth";

// dotenv.config();

// interface QboPayment {
//   Id: string;
//   TotalAmt: number;
//   TxnDate: string;
//   Line: {
//     LinkedTxn?: {
//       TxnId: string;
//       TxnType: "Invoice";
//     }[];
//   }[];
// }

// interface QboPaymentResponse {
//   QueryResponse?: {
//     Payment?: QboPayment[];
//   };
// }

// interface FrappePaymentEntryPayload {
//   payment_type: "Receive";
//   party_type: "Customer";
//   party: string;
//   posting_date: string;
//   paid_amount: number;
//   received_amount: number;
//   paid_to: string;
//   mode_of_payment: string;
//   references: {
//     reference_doctype: string;
//     reference_name: string;
//     allocated_amount: number;
//   }[];
//   custom_qbo_payment_id: string;
//   custom_sync_status?: string; // Adding the custom_sync_status field
// }

// interface FrappeDocCreateResponse {
//   name: string;
//   [key: string]: any;
// }

// async function fetchQboPaymentsPaginated(): Promise<QboPayment[]> {
//   const baseUrl = await getQboBaseUrl();
//   const headers = await getQboAuthHeaders();
//   let payments: QboPayment[] = [];
//   let start = 1;

//   while (true) {
//     const query = `SELECT Id, TxnDate, TotalAmt, Line FROM Payment STARTPOSITION ${start} MAXRESULTS 1000`;
//     const response = await axios.get(`${baseUrl}/query`, {
//       params: { query },
//       headers,
//     });

//     const data = response.data as QboPaymentResponse;
//     const batch = data.QueryResponse?.Payment || [];
//     payments = payments.concat(batch);

//     if (batch.length < 1000) break; // Done paginating
//     start += 1000;
//   }

//   return payments;
// }

// async function main() {
//   const allPayments = await fetchQboPaymentsPaginated();

//   for (const payment of allPayments) {
//     for (const line of payment.Line || []) {
//       for (const txn of line.LinkedTxn || []) {
//         if (txn.TxnType !== "Invoice") continue;

//         const qboInvoiceId = txn.TxnId;

//         // Find matching ERPNext Sales Invoice
//         const frappeInvoices = await frappe.getAllFiltered("Sales Invoice", {
//           filters: {
//             custom_qbo_sales_invoice_id: qboInvoiceId,
//             docstatus: 1,
//           },
//           fields: ["name", "customer", "outstanding_amount"],
//           limit: 1,
//         });

//         if (!frappeInvoices.length) continue;

//         const frappeInvoice = frappeInvoices[0];

//         // Skip if already synced
//         const existing = await frappe.getAllFiltered("Payment Entry", {
//           filters: {
//             custom_qbo_payment_id: payment.Id,
//           },
//           limit: 1,
//         });

//         if (existing.length > 0) {
//           console.log(`✅ QBO Payment ${payment.Id} already synced.`);
//           continue;
//         }

//         console.log(`💸 Creating Payment Entry for QBO Payment ID: ${payment.Id}`);

//         const paymentEntry: FrappePaymentEntryPayload & {
//           reference_no: string;
//           reference_date: string;
//         } = {
//           payment_type: "Receive",
//           party_type: "Customer",
//           party: frappeInvoice.customer,
//           posting_date: payment.TxnDate,
//           paid_amount: payment.TotalAmt,
//           received_amount: payment.TotalAmt,
//           paid_to: "Bank Account - F",
//           mode_of_payment: "Cash",
//           reference_no: payment.Id,
//           reference_date: payment.TxnDate,
//           references: [
//             {
//               reference_doctype: "Sales Invoice",
//               reference_name: frappeInvoice.name,
//               allocated_amount: payment.TotalAmt,
//             },
//           ],
//           custom_qbo_payment_id: payment.Id,
//           custom_sync_status: "Pending", // Initially set to Pending
//         };

//         try {
//           console.log("📤 Payload sent to Frappe:", JSON.stringify(paymentEntry, null, 2));
//           const created = await frappe.createDoc<FrappeDocCreateResponse>("Payment Entry", paymentEntry);
//           const createdName = created.name;

//           // Update the custom_sync_status field before submitting
//           created.custom_sync_status = "Synced"; // Set sync status to "Synced"

//           // ✅ Submit the newly created Payment Entry
//           await frappe.submitDoc("Payment Entry", createdName);

//           console.log(`✅ Created and submitted Payment Entry ${createdName} for ${frappeInvoice.name}`);
//           console.log(`✅ Created Payment Entry ${created.name} for ${frappeInvoice.name}`);
//         } catch (err: any) {
//           console.error("❌ Error creating Payment Entry:", err.response?.data || err.message);
//         }
//       }
//     }
//   }

//   console.log("🎉 QBO payment sync completed.");
// }

// main();
// src/syncQboPaymentsToErp.ts

// src/syncSingleQboPayment.ts

import dotenv from "dotenv";
dotenv.config();

import axios from "axios";
import { frappe } from "./frappe";
import { getQboAuthHeaders, getQboBaseUrl } from "./auth";

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

interface FrappeDocCreateResponse {
  name: string;
  [key: string]: any;
}

export async function syncSingleQboPayment(paymentId: string) {
  try {
    console.log(`🔔 Starting sync for QBO Payment ID: ${paymentId}`);

    const baseUrl = await getQboBaseUrl();
    const headers = await getQboAuthHeaders();

    const url = `${baseUrl}/payment/${paymentId}`;
    console.log(`🌐 Fetching QBO Payment from: ${url}`);

    const response = await axios.get<{ Payment: QboPayment }>(url, { headers });

    const payment = response.data.Payment;
    if (!payment) {
      console.log(`⚠️ No payment found in QBO for ID: ${paymentId}`);
      return;
    }
    console.log(`✅ Found QBO Payment: ID=${paymentId}, Amount=${payment.TotalAmt}, Date=${payment.TxnDate}`);

    if (!payment.Line || payment.Line.length === 0) {
      console.log(`⚠️ Payment ID ${payment.Id} has no Line items.`);
      return;
    }

    for (const [lineIndex, line] of payment.Line.entries()) {
      console.log(`➡️ Processing Line ${lineIndex + 1} of Payment ${paymentId}`);

      if (!line.LinkedTxn || line.LinkedTxn.length === 0) {
        console.log(`⚠️ Line ${lineIndex + 1} has no linked transactions.`);
        continue;
      }

      for (const [txnIndex, txn] of line.LinkedTxn.entries()) {
        console.log(`  🔗 LinkedTxn ${txnIndex + 1}: TxnId=${txn.TxnId}, TxnType=${txn.TxnType}`);

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

        // Optional: Also check if invoice is fully paid, skip if so (additional safety)
        if (frappeInvoice.outstanding_amount <= 0) {
          console.log(`  ⚠️ ERPNext Sales Invoice ${frappeInvoice.name} is already fully paid. Skipping Payment Entry creation.`);
          continue;
        }

        console.log(`The Invoice name is ${frappeInvoice.name}`);

        // Build Payment Entry payload
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
    console.error("❌ Error syncing payment:", err.response?.data || err.message || err);
  }
}

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
