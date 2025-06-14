import frappe
import subprocess
import os
from frappe.utils import now_datetime


def sync_qbo_cost_on_update(doc, method):
    #Seperate method that needs to be called for sales taxes before save
    set_item_tax_template(doc, method)


    try:
        if not hasattr(doc, "_original"):
            doc._original = frappe.get_doc(doc.doctype, doc.name)

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
    try:
        if not hasattr(doc, "_original"):
            doc._original = frappe.get_doc(doc.doctype, doc.name)

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


def mark_qbo_sync_status(doctype: str, docname: str, status: str):
    """Set last_synced and sync_status after QBO update."""
    try:
        doc = frappe.get_doc(doctype, docname)
        doc.db_set("custom_last_synced_at", now_datetime())
        doc.db_set("custom_sync_status", status)
    except Exception as e:
        frappe.logger().error(f"❌ Failed to update sync status for {doctype} {docname}: {str(e)}")
        print(f"❌ Error in mark_qbo_sync_status: {e}")


def run_qbo_script(script_name: str, item_name: str, new_value: str) -> bool:
    """Run a TypeScript script via subprocess and return True on success."""
    try:
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
    Set item_tax_template based on custom tax_category field.
    """
    if hasattr(doc, "tax_category"):
        if doc.tax_category == "Taxable":
            doc.item_tax_template = "MD Sales Tax - Taxable"
        elif doc.tax_category == "Not Taxable":
            doc.item_tax_template = "MD Sales Tax - Not Taxable"