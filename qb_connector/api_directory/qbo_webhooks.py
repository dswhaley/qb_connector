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


def manage_invoicing(invoice_id: str, realm_id: str) -> None:
    qbo_invoice = fetch_invoice(invoice_id, realm_id)
    if not qbo_invoice:
        print(f"⚠️ Invoice {invoice_id} could not be fetched from QBO.")
        return

    frappe_invoice = get_sales_invoice_by_qbo_id(invoice_id)
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
    discount_amount = abs(net_total - (qbo_total - qbo_tax))
    discount_percentage = round((discount_amount / net_total) * 100)

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



def get_qbo_invoice_net_total(invoice: dict) -> float:
    total = 0.0
    for line in invoice.get("Line", []):
        if line.get("DetailType") == "SalesItemLineDetail":
            total += float(line.get("Amount", 0))
    return total


def get_sales_invoice_by_qbo_id(invoice_id: str):
    name = frappe.get_value(
        "Sales Invoice", {"custom_qbo_sales_invoice_id": invoice_id}, "name"
    )
    return frappe.get_doc("Sales Invoice", name) if name else None


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