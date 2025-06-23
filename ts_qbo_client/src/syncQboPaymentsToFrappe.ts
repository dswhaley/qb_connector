import dotenv from "dotenv";
import axios from "axios";
import { frappe } from "./frappe";
import { getQboAuthHeaders, getQboBaseUrl } from "./auth";

dotenv.config();

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

interface QboPaymentResponse {
  QueryResponse?: {
    Payment?: QboPayment[];
  };
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
}

interface FrappeDocCreateResponse {
  name: string;
  [key: string]: any;
}

async function fetchQboPaymentsPaginated(): Promise<QboPayment[]> {
  const baseUrl = await getQboBaseUrl();
  const headers = await getQboAuthHeaders();
  let payments: QboPayment[] = [];
  let start = 1;

  while (true) {
    const query = `SELECT Id, TxnDate, TotalAmt, Line FROM Payment STARTPOSITION ${start} MAXRESULTS 1000`;
    const response = await axios.get(`${baseUrl}/query`, {
      params: { query },
      headers,
    });

    const data = response.data as QboPaymentResponse;
    const batch = data.QueryResponse?.Payment || [];
    payments = payments.concat(batch);

    if (batch.length < 1000) break; // Done paginating
    start += 1000;
  }

  return payments;
}

async function main() {
  const allPayments = await fetchQboPaymentsPaginated();

  for (const payment of allPayments) {
    for (const line of payment.Line || []) {
      for (const txn of line.LinkedTxn || []) {
        if (txn.TxnType !== "Invoice") continue;

        const qboInvoiceId = txn.TxnId;

        // Find matching ERPNext Sales Invoice
        const frappeInvoices = await frappe.getAllFiltered("Sales Invoice", {
          filters: {
            custom_qbo_sales_invoice_id: qboInvoiceId,
            docstatus: 1,
          },
          fields: ["name", "customer", "outstanding_amount"],
          limit: 1,
        });

        if (!frappeInvoices.length) continue;

        const frappeInvoice = frappeInvoices[0];

        // Skip if already synced
        const existing = await frappe.getAllFiltered("Payment Entry", {
          filters: {
            custom_qbo_payment_id: payment.Id,
          },
          limit: 1,
        });

        if (existing.length > 0) {
          console.log(`✅ QBO Payment ${payment.Id} already synced.`);
          continue;
        }

        console.log(`💸 Creating Payment Entry for QBO Payment ID: ${payment.Id}`);

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
        paid_to: "Bank Account - F",
        mode_of_payment: "Cash",
        reference_no: payment.Id,
        reference_date: payment.TxnDate,
        references: [
            {
            reference_doctype: "Sales Invoice",
            reference_name: frappeInvoice.name,
            allocated_amount: payment.TotalAmt,
            },
        ],
        custom_qbo_payment_id: payment.Id,
        };

        try {
          console.log("📤 Payload sent to Frappe:", JSON.stringify(paymentEntry, null, 2));
          const created = await frappe.createDoc<FrappeDocCreateResponse>("Payment Entry", paymentEntry);
          const createdName = created.name;
          
          // ✅ Submit the newly created Payment Entry
          await frappe.submitDoc("Payment Entry", createdName);

          console.log(`✅ Created and submitted Payment Entry ${createdName} for ${frappeInvoice.name}`);
          console.log(`✅ Created Payment Entry ${created.name} for ${frappeInvoice.name}`);
        } catch (err: any) {
          console.error("❌ Error creating Payment Entry:", err.response?.data || err.message);
        }
      }
    }
  }

  console.log("🎉 QBO payment sync completed.");
}

main();
