import frappe
import subprocess
import json
import os
from frappe.utils import now_datetime

# ========== Hook: Sync Sales Invoice to QBO ==========
def sync_sales_invoice_to_qbo(doc, method):
    print(f"🚨 Hook triggered for Sales Invoice: {doc.name}")
    frappe.logger().info(f"🚨 Hook triggered for Sales Invoice: {doc.name}")

    try:
        print("🔧 Starting QBO script execution...")
        success = run_qbo_script("syncInvoiceToQbo.ts", doc.name)
        print(f"✅ Script execution completed. Success: {success}")

        status = "Synced" if success else "Failed"

        print(f"📨 Enqueuing sync status update → {status}")
        frappe.enqueue("qb_connector.qbo_hooks.mark_qbo_sync_status",
                       doctype=doc.doctype,
                       docname=doc.name,
                       status=status)

        print(f"🧾 Enqueued Sales Invoice sync status update for {doc.name}")
        frappe.logger().info(f"🧾 Enqueued Sales Invoice sync status update → {status}")
    except Exception as e:
        print(f"❌ Error in sync_sales_invoice_to_qbo: {e}")
        frappe.logger().error(f"❌ Sales Invoice sync failed: {str(e)}")


def run_qbo_script(script_name: str, docname: str) -> bool:
    try:
        current_dir = os.path.dirname(os.path.abspath(__file__))
        app_root = os.path.abspath(os.path.join(current_dir, ".."))
        script_dir = os.path.join(app_root, "ts_qbo_client", "src")
        script_path = os.path.join(script_dir, script_name)

        print(f"🔍 Script path: {script_path}")
        print(f"📦 Running: npx ts-node {script_path} {docname}")

        process = subprocess.Popen(
            ["npx", "ts-node", os.path.basename(script_path), docname],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=script_dir
        )

        stdout, stderr = process.communicate()

        if stdout:
            print(f"📤 STDOUT:\n{stdout}")
            frappe.logger().info(f"[Invoice Sync Output] {stdout}")

        if stderr:
            print(f"❗ STDERR:\n{stderr}")
            frappe.logger().error(f"[Invoice Sync Error] {stderr}")

        return process.returncode == 0

    except Exception as e:
        print(f"❌ Exception during script execution: {e}")
        frappe.logger().error(f"❌ Exception in run_qbo_script: {str(e)}")
        return False


# ========== Validation: Ensure customer discount is sane ==========
def validate_customer_discount(doc, method):
    print("✅ Validate Customer Hook Started")
    customer_name = doc.customer
    if not customer_name:
        return

    customer = frappe.get_doc("Customer", customer_name)
    discount = customer.get("custom_discount_")

    try:
        discount_val = float(discount)
        if discount_val < 0 or discount_val > 100:
            frappe.throw(f"🚫 Invalid custom discount for '{customer_name}': {discount_val}%. Must be between 0 and 100.")
    except (TypeError, ValueError):
        frappe.throw(f"🚫 Custom discount for '{customer_name}' must be a number between 0 and 100.")


# ========== Dynamic Discount Logic ==========
def apply_dynamic_discount(doc, method):
    customer_name = doc.customer
    if not customer_name:
        return

    total_qty = doc.total_qty or 0
    discount_modifier = get_qty_discount_modifier(total_qty)

    customer = frappe.get_doc("Customer", customer_name)
    base_discount = float(customer.get("custom_discount_") or 0)

    total_discount_percentage = base_discount + discount_modifier

    # Set standard ERPNext discount fields
    doc.apply_discount_on = "Net Total"
    doc.additional_discount_percentage = total_discount_percentage
    #doc.additional_discount_amount = 0  # Let ERPNext calculate this

    frappe.msgprint(f"✅ Applied total discount of {total_discount_percentage:.2f}%")


def get_qty_discount_modifier(qty):
    if qty >= 10000: return 20
    if qty >= 4000: return 17
    if qty >= 3000: return 15
    if qty >= 2000: return 12
    if qty >= 1500: return 10
    if qty >= 1200: return 7
    if qty >= 800: return 5
    if qty >= 500: return 2
    return 0
