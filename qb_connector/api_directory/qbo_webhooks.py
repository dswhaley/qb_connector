import os
import json
import hmac
import hashlib
from pathlib import Path
from typing import Optional
import base64
import frappe
import requests
from dotenv import load_dotenv
import subprocess
from datetime import timedelta
import traceback

@frappe.whitelist(allow_guest=True)
def handle_qbo_webhook():
    """
    Entry point called by Intuit’s webhook.
    Verifies signature, loops through entity events, and triggers sync logic.
    """
    try:
        raw_body: bytes = frappe.request.get_data()
        signature_header: str = frappe.get_request_header("intuit-signature")
        print("📦 All request headers:", dict(frappe.request.headers))

        verifier_token: bytes = (
            frappe.db.get_single_value("QuickBooks Settings", "verifiertoken").encode()
        )

        expected_b64_digest = base64.b64encode(hmac.new(verifier_token, raw_body, hashlib.sha256).digest()).decode()


        if not hmac.compare_digest(expected_b64_digest, signature_header):
            frappe.local.response.http_status_code = 401
            return {"error": "Invalid signature"}


        payload = json.loads(raw_body)
        print("✅ QBO Webhook Payload:\n" + json.dumps(payload, indent=2))

        for notification in payload.get("eventNotifications", []):
            realm_id = notification.get("realmId")
            for entity in notification.get("dataChangeEvent", {}).get("entities", []):
                entity_type = entity.get("name")
                entity_id = entity.get("id")
                operation = entity.get("operation")
                updated_at = entity.get("lastUpdated")

                if entity_type == "Invoice":
                    manage_invoicing(entity_id, realm_id)

                if entity_type == "Payment":
                    manage_payments(entity_id, realm_id)

                print(
                    f"🔔 {operation} on {entity_type} {entity_id} "
                    f"(Realm: {realm_id}) at {updated_at}"
                )

        frappe.local.response.http_status_code = 200
        return {"status": "success"}

    except Exception:
        print("❌ Error during webhook handling:")
        print(frappe.get_traceback())
        frappe.local.response.http_status_code = 500
        return {"error": "Internal server error"}


def verify_signature(raw_body: bytes, signature: Optional[str], secret: bytes) -> bool:
    """Validate Intuit’s HMAC-SHA256 webhook signature (base64)."""
    if not signature:
        return False

    digest = hmac.new(secret, raw_body, hashlib.sha256).digest()  # raw bytes
    encoded_digest = base64.b64encode(digest).decode()  # base64 string

    return hmac.compare_digest(encoded_digest, signature)


def manage_payments(payment_id: str, realm_id: str) -> None:
    """
    Triggered from handle_qbo_webhook() when a QBO Payment webhook is received.
    Runs the TypeScript sync script for the given payment ID using run_qbo_script().
    """
    if not payment_id:
        frappe.logger().error("❌ manage_payments: No payment_id provided.")
        return

    script_name = "syncQboPaymentsToFrappe.ts"

    frappe.logger().info(f"🔁 Syncing QBO Payment {payment_id} via {script_name}")

    success = run_qbo_script(script_name, docname=payment_id)

    if not success:
        msg = f"❌ Failed to sync QBO Payment ID: {payment_id}"
        frappe.logger().error(msg)
        raise Exception(msg)

    frappe.logger().info(f"✅ Successfully synced QBO Payment ID: {payment_id}")


def manage_invoicing(invoice_id: str, realm_id: str) -> None:
    """
    Main entry point to sync QBO invoice changes with Frappe Sales Invoice.
    Cancels and replaces the Frappe invoice if grand totals differ.
    """
    qbo_invoice = fetch_invoice(invoice_id, realm_id)
    if not qbo_invoice:
        print(f"⚠️ Invoice {invoice_id} could not be fetched from QBO.")
        return

    frappe_invoice = get_sales_invoice_by_qbo_id(invoice_id)
    if frappe_invoice is None:
        print(f"⚠️ No local Sales Invoice with custom_qbo_sales_invoice_id = {invoice_id}")
        customer_ref = qbo_invoice.get("CustomerRef", {})
        customer_id = customer_ref.get("value")
        customer_name = get_customer_by_qbo_id(customer_id)
        items = build_items_from_qbo_invoice(qbo_invoice)
        new_invoice = create_new_sales_invoice(qbo_invoice=qbo_invoice, invoice_id=invoice_id, customer_name=customer_name, items=items, shipment_tracker_name=None)
        print(f"✅ Created new Sales Invoice {new_invoice.name} for QBO Invoice {invoice_id}")
        return
    
    created_at = frappe_invoice.creation
    if isinstance(created_at, str):
        created_at = frappe.utils.get_datetime(created_at)
    if frappe.utils.now_datetime() - created_at < timedelta(seconds=5):
        print(f"⏳ Skipping QBO sync for {invoice_id}; invoice just created by us.")
        return

    qbo_total = float(qbo_invoice.get("TotalAmt", 0))
    shipment_tracker_name = get_shipment_tracker_for_invoice(frappe_invoice.name)
    if not is_total_different(frappe_invoice.grand_total, qbo_total):
        print(f"✅ Invoice {frappe_invoice.name} totals match QBO; no action needed.")
        return

    if not cancel_and_delete_invoice(frappe_invoice, shipment_tracker_name):
        return

    items = build_items_from_qbo_invoice(qbo_invoice)

    customer_name = get_customer_by_qbo_id(qbo_invoice.get("CustomerRef", {}).get("value"))
    if not customer_name:
        print(f"❌ Customer with QBO ID {qbo_invoice.get('CustomerRef', {}).get('value')} not found in Frappe.")
        return

    create_new_sales_invoice(qbo_invoice, invoice_id, customer_name, items, shipment_tracker_name)

def get_shipment_tracker_for_invoice(sales_invoice_name):
    shipment_tracker_name = frappe.db.exists(
        "Shipment Tracker",
        {"sales_invoice": sales_invoice_name}
    )
    return shipment_tracker_name if shipment_tracker_name else None

def is_total_different(frappe_total: float, qbo_total: float, tolerance: float = 0.01) -> bool:
    """
    Check if the Frappe and QBO invoice grand totals differ beyond a small tolerance.
    """
    return abs(frappe_total - qbo_total) >= tolerance

def cancel_and_delete_invoice(frappe_invoice: str, shipment_tracker_name: str) -> bool:
    """
    Cancels and deletes the given Frappe Sales Invoice, even if it's linked to Payment Ledger Entries and GL Entries.
    Also unlinks from Shipment Tracker. Does NOT delete the Sales Order.
    Returns True if successful, False otherwise.
    """
    frappe.set_user("Administrator")

    try:
        # Fetch the full document if only name was passed
        if isinstance(frappe_invoice, str):
            invoice = frappe.get_doc("Sales Invoice", frappe_invoice)
        else:
            invoice = frappe_invoice

        # Cancel the invoice
        if invoice.docstatus == 1:
            invoice.cancel()
            frappe.db.commit()
            print(f"✅ Cancelled Sales Invoice {invoice.name}")

        # Remove Payment Ledger Entry links if any
        linked_ples = frappe.db.get_all(
            "Payment Ledger Entry",
            filters={"voucher_no": invoice.name, "voucher_type": "Sales Invoice"},
            pluck="name"
        )
        for ple_name in linked_ples:
            frappe.delete_doc("Payment Ledger Entry", ple_name, force=True)
            print(f"🧹 Deleted Payment Ledger Entry: {ple_name}")

        # Remove all GL Entries linked to the Sales Invoice
        linked_gl_entries = frappe.db.get_all(
            "GL Entry",
            filters={"voucher_no": invoice.name, "voucher_type": "Sales Invoice"},
            pluck="name"
        )
        for gl_name in linked_gl_entries:
            frappe.delete_doc("GL Entry", gl_name, force=True)
            print(f"🧹 Deleted GL Entry: {gl_name}")

    except Exception as e:
        print(f"❌ Failed to cancel invoice {frappe_invoice}: {e}")
        print(traceback.format_exc())
        return False

    try:
        # Clear reference from Shipment Tracker, if applicable
        if shipment_tracker_name and frappe.db.exists("Shipment Tracker", shipment_tracker_name):
            shipment_tracker = frappe.get_doc("Shipment Tracker", shipment_tracker_name)
            shipment_tracker.sales_invoice = None
            shipment_tracker.save(ignore_permissions=True)
            print(f"🔗 Unlinked from Shipment Tracker: {shipment_tracker_name}")

        # Delete the Sales Invoice forcibly
        frappe.delete_doc("Sales Invoice", invoice.name, force=True)
        frappe.db.commit()
        print(f"✅ Deleted Sales Invoice {invoice.name}")
        return True

    except Exception as e:
        print(f"❌ Failed to delete invoice {invoice.name}: {e}")
        print(traceback.format_exc())
        return False






def build_items_from_qbo_invoice(qbo_invoice: dict) -> list:
    """
    Builds a list of Sales Invoice items for Frappe based on QBO invoice lines.
    Skips lines without matching Frappe item.
    """
    items = []
    for line in qbo_invoice.get("Line", []):
        if line.get("DetailType") != "SalesItemLineDetail":
            continue

        detail = line.get("SalesItemLineDetail", {})
        qbo_item_id = detail.get("ItemRef", {}).get("value")
        if not qbo_item_id:
            continue

        try:
            item_code = frappe.get_value("Item", {"custom_qbo_item_id": qbo_item_id}, "name")
            if not item_code:
                print(f"⚠️ Skipping unknown QBO item ID: {qbo_item_id}")
                continue
        except Exception:
            frappe.log_error(frappe.get_traceback(), "QBO Item Lookup Error")
            continue

        qty = float(detail.get("Qty", 0))
        rate = float(detail.get("UnitPrice", 0))
        amount = float(line.get("Amount", 0))

        items.append({
            "item_code": item_code,
            "qty": qty,
            "rate": rate,
            "amount": amount,
        })
    return items


def create_new_sales_invoice(qbo_invoice: dict, invoice_id: str, customer_name: str, items: list, shipment_tracker_name: str) -> None:
    """
    Creates and submits a new Sales Invoice in Frappe based on the QBO invoice data.
    Links the new invoice to the given Sales Order if provided.
    Sets `custom_dont_sync` to 1 to avoid sync loops.
    """
    qbo_total = float(qbo_invoice.get("TotalAmt", 0))
    qbo_tax = float(qbo_invoice.get("TxnTaxDetail", {}).get("TotalTax", 0))
    qbo_net = qbo_total - qbo_tax
    qbo_outstanding = float(qbo_invoice.get("Balance", 0))
    currency = qbo_invoice.get("CurrencyRef", {}).get("value") or "USD"
    qbo_discount_rate = get_discount_percent_from_invoice(qbo_invoice)
    qbo_discount_amount = float(qbo_invoice.get("DiscountAmt", 0))
    qbo_exchange_rate = float(qbo_invoice.get("ExchangeRate", 1))
    if qbo_tax > 0:
        exempt_from_sales_tax = 0
    else:
        exempt_from_sales_tax = 1

    new_invoice_doc = frappe.get_doc({
        "doctype": "Sales Invoice",
        "customer": customer_name,
        "currency": currency,
        "custom_dont_sync": 1,
        "custom_sync_status": "Synced",
        "total_taxes_and_charges": qbo_tax,
        "base_grand_total": qbo_total,
        "additional_discount_percentage": qbo_discount_rate,
        "base_total_taxes_and_charges": qbo_tax,
        "base_rounded_total": qbo_total,
        "outstanding_amount": qbo_outstanding,
        "exempt_from_sales_tax": exempt_from_sales_tax,
        "disable_rounded_total": 1,
        "custom_qbo_sales_invoice_id": invoice_id,
        "items": items,
        "custom_built_from_webhook": 1,
        "conversion_rate": qbo_exchange_rate,
        "apply_discount_on": "Net Total",
    })

    if not exempt_from_sales_tax:
        tax_rate = qbo_tax / qbo_net * 100 if qbo_net else 0
        new_invoice_doc.append("taxes", {
            "charge_type": "On Net Total",
            "account_head": "ST 6% - F",
            "description": "Maryland Sales Tax",
            "rate": tax_rate,
            })
    try:
        new_invoice_doc.insert(ignore_permissions=True)
        new_invoice_doc.submit()

        if frappe.db.exists("Shipment Tracker", shipment_tracker_name):
            shipment_tracker = frappe.get_doc("Shipment Tracker", shipment_tracker_name)
            shipment_tracker.sales_invoice = new_invoice_doc.name
            shipment_tracker.save(ignore_permissions=True)
        frappe.db.commit()
        return new_invoice_doc
    except Exception as e:
        print(f"❌ Failed to create new Sales Invoice: {str(e)}")


def get_qbo_invoice_net_total(invoice: dict) -> float:
    total = 0.0
    for line in invoice.get("Line", []):
        if line.get("DetailType") == "SalesItemLineDetail":
            total += float(line.get("Amount", 0))
    return total


def get_sales_invoice_by_qbo_id(invoice_id: str):
    invoices = frappe.get_all(
        "Sales Invoice",
        filters={"custom_qbo_sales_invoice_id": invoice_id},
        fields=["name"]
    )
    print(f"Found {len(invoices)} Sales Invoices with custom_qbo_sales_invoice_id = {invoice_id}\n{invoices}")
    if len(invoices) == 1:
        return frappe.get_doc("Sales Invoice", invoices[0]["name"])
    elif len(invoices) == 0:
        print(f"⚠️ No Sales Invoice found with custom_qbo_sales_invoice_id = {invoice_id}")
        return None
    else:
        return_inv = [None]
        for inv in invoices:
            print(f"Checking Sales Invoice {inv['name']} for Shipment Tracker...")
            shipment_tracker = get_shipment_tracker_for_invoice(inv["name"])
            print(f"Shipment Tracker for invoice {inv['name']}: {shipment_tracker}")
            if shipment_tracker is not None:
                return_inv[0] = inv["name"]
                print(f"Found Shipment Tracker for invoice {inv['name']}, returning it.")
            elif return_inv[0] is None:
                return_inv[0] = inv["name"]
                print(f"No Shipment Tracker found for invoice {inv['name']}, returning it because there is no inv to return.")
            else:
                cancel_and_delete_invoice(inv["name"], None)
                print(f"Deleted Sales Invoice {inv['name']} because it had no Shipment Tracker. and a different one did")
        if return_inv:
            print(f"Returning Sales Invoice {return_inv[0]} with custom_qbo_sales_invoice_id = {invoice_id}\nReturn Inv is size {len(return_inv)}")
            return frappe.get_doc("Sales Invoice", return_inv[0])
        return None


def get_customer_by_qbo_id(customer_id: str):
    matches = frappe.get_all(
        "Customer",
        filters={"custom_qbo_customer_id": customer_id},
        fields=["name"]
    )
    return matches[0]["name"] if matches else None


def fetch_invoice(invoice_id: str, realm_id: str) -> Optional[dict]:
    settings = frappe.get_single("QuickBooks Settings")
    access_token = settings.accesstoken

    env_path = Path(frappe.get_app_path("qb_connector")).parent / "ts_qbo_client" / ".env"

    load_dotenv(dotenv_path=env_path)

    qbo_env = os.getenv("QBO_ENV", "production").lower()

    base_url = (
        "https://sandbox-quickbooks.api.intuit.com"
        if qbo_env == "sandbox"
        else "https://quickbooks.api.intuit.com"
    )

    url = f"{base_url}/v3/company/{realm_id}/invoice/{invoice_id}"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

    try:
        response = requests.get(url, headers=headers, timeout=15)
        response.raise_for_status()
        invoice_json = response.json().get("Invoice")
        if not invoice_json:
            print(f"⚠️ Invoice {invoice_id} missing in QBO API response.")
        else:
            print(f"✅ Retrieved QBO Invoice {invoice_id}")
        return invoice_json

    except requests.exceptions.HTTPError as err:
        print(f"❌ HTTP error fetching invoice {invoice_id}: {err}")
        frappe.log_error(str(err), "QBO Invoice Fetch HTTPError")
    except Exception:
        print("❌ Unexpected error fetching")

def get_discount_percent_from_invoice(invoice: dict) -> Optional[float]:
    for line in invoice.get("Line", []):
        if line.get("DetailType") == "DiscountLineDetail":
            discount_detail = line.get("DiscountLineDetail", {})
            if discount_detail.get("PercentBased"):
                return discount_detail.get("DiscountPercent")
    return None
def run_qbo_script(script_name: str, docname: str = None) -> str | None:
    """
    Runs a Node.js TypeScript script to sync a Payment or Invoice to Frappe from QBO.
    Returns True if successful, False otherwise.
    """
    try:
        # Get the absolute path of the current file
        current_dir = os.path.dirname(os.path.abspath(__file__))
        # Go up two levels to the app root
        app_root = os.path.abspath(os.path.join(current_dir, "..", ".."))
        # Build the path to the TypeScript client source directory
        script_dir = os.path.join(app_root, "ts_qbo_client", "src")
        # Build the full path to the script to run
        script_path = os.path.join(script_dir, script_name)

        print(f"🔍 Script path: {script_path}")  # Log the script path for debugging

        # If a docname is provided, include it as an argument to the script
        if docname:
            print(f"📦 Running: npx ts-node {script_path} {docname}")  # Log the command
            process = subprocess.Popen(
                ["npx", "ts-node", os.path.basename(script_path), docname],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=script_dir
            )
        else:
            print(f"📦 Running: npx ts-node {script_path}")
            process = subprocess.Popen(
                ["npx", "ts-node", os.path.basename(script_path)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=script_dir
            )

        stdout, stderr = process.communicate()

        if stdout:
            print(f"📤 STDOUT:\n{stdout}")
            frappe.logger().info(f"[Payment Entry Sync Output] {stdout}")

        if stderr:
            print(f"❗ STDERR:\n{stderr}")
            frappe.logger().error(f"[Payment Entry Sync Error] {stderr}")

        return process.returncode == 0

    except Exception as e:
        print(f"❌ Exception during script execution: {e}")
        frappe.logger().error(f"❌ Exception in run_qbo_script: {str(e)}")
        return False

