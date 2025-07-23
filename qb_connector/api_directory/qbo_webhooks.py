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


@frappe.whitelist(allow_guest=True)
def handle_qbo_webhook():
    """
    Entry point called by Intuit’s webhook.
    Verifies signature, loops through entity events, and triggers sync logic.
    """
    print("TRYING TO CONNECT WITH WEBHOOK")
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
    import frappe

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
    qbo_invoice = fetch_invoice(invoice_id, realm_id)
    if not qbo_invoice:
        print(f"⚠️ Invoice {invoice_id} could not be fetched from QBO.")
        return

    frappe_invoice = get_sales_invoice_by_qbo_id(invoice_id, qbo_invoice)
    print(f"Frappe Invoice: {frappe_invoice}")
    if not frappe_invoice:
        print(f"⚠️ No local Sales Invoice with custom_qbo_sales_invoice_id = {invoice_id}")
        return

    # Delete existing items using SQL because the invoice is submitted
    frappe.db.sql("""
        DELETE FROM `tabSales Invoice Item`
        WHERE parent=%s AND parenttype='Sales Invoice'
    """, frappe_invoice.name)

    quantity = 0
    net_total = 0
    # Insert new items based on QBO invoice, using indexed loop for idx
    for idx, line in enumerate(qbo_invoice.get("Line", []), start=1):
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
        quantity += qty
        rate = float(detail.get("UnitPrice", 0))
        amount = float(line.get("Amount", 0))
        net_total += amount

        frappe.db.sql("""
            INSERT INTO `tabSales Invoice Item`
            (`name`, `parent`, `parenttype`, `parentfield`, `item_code`, `qty`, `rate`, `amount`, `idx`, `creation`, `modified`, `owner`, `docstatus`)
            VALUES (%s, %s, 'Sales Invoice', 'items', %s, %s, %s, %s, %s, NOW(), NOW(), %s, 1)
        """, (
            frappe.generate_hash(length=10),
            frappe_invoice.name,
            item_code,
            qty,
            rate,
            amount,
            idx,
            "Administrator"
        ))

    # Update parent totals
    qbo_total = float(qbo_invoice.get("TotalAmt", 0))
    qbo_net = get_qbo_invoice_net_total(qbo_invoice)
    qbo_tax = float(qbo_invoice.get("TxnTaxDetail", {}).get("TotalTax", 0))

    if net_total != 0 and qbo_total and qbo_tax:
        discount_amount = abs(net_total - (qbo_total - qbo_tax))
        discount_percentage = round((discount_amount / net_total) * 100)
    else:
        discount_amount = 0
        discount_percentage = 0
    try:
        frappe.db.set_value("Sales Invoice", frappe_invoice.name, {
            "grand_total": qbo_total,
            "total": net_total,
            "additional_discount_percentage": discount_percentage,
            "discount_amount": discount_amount,
            "net_total": qbo_total - qbo_tax,
            "total_qty": quantity,
            "rounded_total": qbo_total,
            "total_taxes_and_charges": qbo_tax,
            "base_grand_total": qbo_total,
            "base_net_total": qbo_net,
            "base_total_taxes_and_charges": qbo_tax,
            "outstanding_amount": frappe_invoice.outstanding_amount or 0.0
        })

        frappe.db.commit()
        
        print(f"✅ Synced submitted invoice {frappe_invoice.name} with QBO invoice {invoice_id}")
    except Exception as e:
        print(f"Failed to update invoice due to: {str(e)}")



def get_qbo_invoice_net_total(invoice: dict) -> float:
    total = 0.0
    for line in invoice.get("Line", []):
        if line.get("DetailType") == "SalesItemLineDetail":
            total += float(line.get("Amount", 0))
    return total


def get_sales_invoice_by_qbo_id(invoice_id: str, invoice):
    name = frappe.get_value(
        "Sales Invoice", {"custom_qbo_sales_invoice_id": invoice_id}, "name"
    )
    if name:
        return frappe.get_doc("Sales Invoice", name)
    else:
        print("Got to else statement")
        customer_ref = invoice.get("CustomerRef", {})
        customer_id = customer_ref.get("value")
        print(f"Customer id: {customer_id}")
        customer_name = get_customer_by_qbo_id(customer_id)
        print(f"Customer name: {customer_name}")
        if not customer_name:
            raise ValueError("QBO Customer does not exist in Frappe")

        # 👇 Ensure all required values are defined
        qbo_total = float(invoice.get("TotalAmt", 0))
        qbo_tax = float(invoice.get("TxnTaxDetail", {}).get("TotalTax", 0))
        qbo_net = qbo_total - qbo_tax
        currency = invoice.get("CurrencyRef", {}).get("value") or "USD"

        print("Making new invoice")
        try:
            new_invoice = frappe.get_doc({
                "doctype": "Sales Invoice",
                "customer": customer_name,
                "currency": currency,
                "conversion_rate": 1.0,
                "custom_dont_sync": 1,
                "grand_total": qbo_total,
                "custom_sync_status": "Synced",
                "rounded_total": qbo_total,
                "total_taxes_and_charges": qbo_tax,
                "base_grand_total": qbo_total,
                "base_net_total": qbo_net,
                "base_total_taxes_and_charges": qbo_tax,
                "base_rounded_total": qbo_total,  # 🟢 Add this field
                "outstanding_amount": 0,
                "items": [  # 👈 This is the ONE placeholder item you wanted
                    {
                        "item_code": "TEMP-PLACEHOLDER",
                        "qty": 1,
                        "rate": 0,
                        "amount": 0
                    }
                ],
                "total": qbo_net,
                "custom_qbo_sales_invoice_id": invoice_id,
                "docstatus": 1
            })
            print("inserting invoice")
            new_invoice.insert(ignore_permissions=True)
            return new_invoice
        except Exception as e:
            print(f"Failed to make invoice due to: {str(e)}")
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

def run_qbo_script(script_name: str, docname: str = None) -> str | None:
    try:
        current_dir = os.path.dirname(os.path.abspath(__file__))
        app_root = os.path.abspath(os.path.join(current_dir, "..", ".."))  # up two levels
        script_dir = os.path.join(app_root, "ts_qbo_client", "src")
        script_path = os.path.join(script_dir, script_name)

        print(f"🔍 Script path: {script_path}")

        # If docname is provided, include it in the command; otherwise, omit it
        if docname:
            print(f"📦 Running: npx ts-node {script_path} {docname}")
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

def mark_qbo_sync_status(doctype: str, docname: str, status: str, payment_id: str = None):
    """Set last_synced and sync_status after QBO update."""
    try:
        doc = frappe.get_doc(doctype, docname)
        doc.db_set("custom_sync_status", status)
        if status != "Synced":
            frappe.msgprint(f"Failed to Sync: {status}")
        # Only update the custom_qbo_sales_invoice_id if invoice_id is provided
        if payment_id:
            doc.db_set("custom_qbo_payment_id", payment_id)
        
        # Save the document with the updated fields
        doc.save()

    except Exception as e:
        frappe.logger().error(f"❌ Failed to update sync status for {doctype} {docname}: {str(e)}")
        print(f"❌ Error in mark_qbo_sync_status: {e}")

