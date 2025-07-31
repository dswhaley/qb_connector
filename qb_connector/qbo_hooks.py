import frappe
import subprocess
import os
from frappe.utils import now_datetime

# qbo_hooks.py
# Hooks and helpers for syncing Item cost/price and tax templates to QuickBooks Online (QBO).

def sync_qbo_cost_on_update(doc, method):
    """
    Syncs the cost (valuation_rate) of an Item to QBO if it has changed.
    Also sets the item tax template before saving.
    Args:
        doc: The Item document being updated.
        method: The event method triggering the hook.
    """
    # Set tax template before save
    set_item_tax_template(doc, method)

    try:
        # Store original doc for comparison if not already present
        if not hasattr(doc, "_original"):
            doc._original = frappe.get_doc(doc.doctype, doc.name)

        # Only sync if valuation_rate has changed and QBO item ID is present
        if doc.valuation_rate != doc._original.valuation_rate and doc.custom_qbo_item_id:
            frappe.logger().info(f"🔁 Detected valuation_rate change for Item {doc.name}")
            success = run_qbo_script("updateQboCost.ts", doc.name, str(doc.valuation_rate))

            status = "Synced" if success else "Failed"
            print(f"Status: {status}")
            frappe.enqueue("qb_connector.qbo_hooks.mark_qbo_sync_status",
                doctype=doc.doctype,
                docname=doc.name,
                status=status)
            print(f"📨 Enqueuing sync status update for {doc.doctype} {doc.name} → {status}")
            frappe.logger().info(f"📨 Enqueuing sync status update for {doc.doctype} {doc.name} → {status}")

    except Exception as e:
        frappe.logger().error(f"❌ Cost sync failed for Item {doc.name}: {str(e)}")


def sync_qbo_price_on_update(doc, method):
    """
    Syncs the price (price_list_rate) of an Item Price to QBO if it has changed.
    Args:
        doc: The Item Price document being updated.
        method: The event method triggering the hook.
    """
    try:
        # Store original doc for comparison if not already present
        if not hasattr(doc, "_original"):
            doc._original = frappe.get_doc(doc.doctype, doc.name)

        # Only sync if price_list_rate has changed
        if doc.price_list_rate != doc._original.price_list_rate:
            item = frappe.get_doc("Item", doc.item_code)
            if item.custom_qbo_item_id:
                success = run_qbo_script("updateQboPrice.ts", item.name, str(doc.price_list_rate))

                status = "Synced" if success else "Failed"
                print(f"Status: {status}")
                frappe.enqueue("qb_connector.qbo_hooks.mark_qbo_sync_status",
                            doctype=item.doctype,
                            docname=item.name,
                            status=status)
    except Exception as e:
        frappe.logger().error(f"❌ Price sync failed for Item Price {doc.name}: {str(e)}")


def mark_qbo_sync_status(doctype: str, docname: str, status: str, invoice_id: str = None):
    """
    Sets last_synced and sync_status after QBO update for Item or Item Price.
    Also updates the custom_qbo_sales_invoice_id if provided.
    Args:
        doctype (str): The DocType name (should be 'Item' or 'Item Price').
        docname (str): The name of the document.
        status (str): The sync status ('Synced' or 'Failed').
        invoice_id (str, optional): The QBO Invoice ID if available.
    """
    try:
        doc = frappe.get_doc(doctype, docname)
        doc.db_set("custom_last_synced_at", now_datetime())
        doc.db_set("custom_sync_status", status)
        if status != "Synced":
            frappe.msgprint(f"Failed to Sync: {status}")
        # Only update the custom_qbo_sales_invoice_id if invoice_id is provided
        if invoice_id:
            doc.db_set("custom_qbo_sales_invoice_id", invoice_id)
        # Save the document with the updated fields
        frappe.db.commit()
    except Exception as e:
        frappe.logger().error(f"❌ Failed to update sync status for {doctype} {docname}: {str(e)}")
        print(f"❌ Error in mark_qbo_sync_status: {e}")


def run_qbo_script(script_name: str, item_name: str, new_value: str) -> bool:
    """
    Runs a Node.js TypeScript script to sync Item cost or price to QBO.
    Returns True if successful, False otherwise.
    Args:
        script_name (str): The TypeScript script filename to run.
        item_name (str): The name of the Item document to sync.
        new_value (str): The new value to set (cost or price).
    Returns:
        bool: True if sync succeeded, False otherwise.
    """
    try:
        # Determine the script directory and path
        current_dir = os.path.dirname(os.path.abspath(__file__))
        app_root = os.path.abspath(os.path.join(current_dir, ".."))
        script_dir = os.path.join(app_root, "ts_qbo_client", "src")
        script_path = os.path.join(script_dir, script_name)

        process = subprocess.Popen(
            ["npx", "ts-node", os.path.basename(script_path), item_name, new_value],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=script_dir
        )

        process.wait()  # ✅ wait for completion before checking exit code

        stderr = process.stderr.read()
        if stderr:
            print(f"❗ STDERR:\n{stderr}")
            frappe.logger().error(f"[QBO Script Error] {stderr}")

        return_code = process.returncode
        print(f"📦 Script exited with code {return_code}")
        return return_code == 0

    except Exception as e:
        print(f"❌ Exception: {e}")
        frappe.logger().error(f"❌ Failed to run script {script_name}: {str(e)}")
        return False


def set_item_tax_template(doc, method):
    """
    Sets the item_tax_template field based on the custom tax_category field.
    Args:
        doc: The Item document being updated.
        method: The event method triggering the hook.
    """
    if hasattr(doc, "tax_category"):
        if doc.tax_category == "Taxable":
            doc.item_tax_template = "MD Sales Tax - Taxable"
        elif doc.tax_category == "Not Taxable":
            doc.item_tax_template = "MD Sales Tax - Not Taxable"

@frappe.whitelist()
def sync_items_from_qbo():
    """
    Triggers a background job to sync items from QBO to ERPNext.
    """
    print("✅ Enqueuing sync_items_from_qbo")
    frappe.logger().info("✅ Enqueuing sync_items_from_qbo")

    frappe.enqueue("qb_connector.qbo_hooks.run_item_sync_script",
        queue="default",
        timeout=600,
        now=False
        )

def run_item_sync_script():
    """
    Runs the TypeScript script to sync items from QBO to ERPNext.
    Logs output and errors for review.
    """
    ts_client_path = os.path.join(frappe.get_app_path("qb_connector"), "..", "ts_qbo_client")

    try:
        result = subprocess.run(
            ["npx", "ts-node", "src/syncItemsFromQbo.ts"],
            cwd=ts_client_path,
            capture_output=True,
            text=True,
            check=True
        )

        print("📤 Script stdout:\n", result.stdout)
        print("⚠️ Script stderr:\n", result.stderr)

        frappe.logger().info("✅ QBO item sync completed")

    except subprocess.CalledProcessError as e:
        print("❌ Script failed with error:\n", e.stderr)
        frappe.logger().error(f"❌ QBO item sync failed: {e.stderr}")
