import frappe
import subprocess
import os
from frappe.utils import now_datetime

def run_qbo_script(script_name: str, item_name: str, new_value: str):
    try:
        # Start from this Python file's location (qb_connector/api/qbo_hooks.py or similar)
        current_dir = os.path.dirname(os.path.abspath(__file__))

        # Go up to the `qb_connector` app root
        app_root = os.path.abspath(os.path.join(current_dir, ".."))

        # Then to the ts_qbo_client/src directory
        script_dir = os.path.join(app_root, "ts_qbo_client", "src")
        script_path = os.path.join(script_dir, script_name)


        process = subprocess.Popen(
            ["npx", "ts-node", os.path.basename(script_path), item_name, new_value],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=script_dir  # make sure ts-node runs in correct folder
        )

        while True:
            output = process.stdout.readline()
            if output:
                print(f"📤 {output.strip()}")
                frappe.logger().info(f"[QBO Script Output] {output.strip()}")
            elif process.poll() is not None:
                break

        stderr = process.stderr.read()
        if stderr:
            print(f"❗ STDERR:\n{stderr}")
            frappe.logger().error(f"[QBO Script Error] {stderr}")

        return process.returncode == 0

    except Exception as e:
        print(f"❌ Exception: {e}")
        frappe.logger().error(f"❌ Failed to run script {script_name}: {str(e)}")
        return False


def sync_qbo_cost_on_update(doc, method):
    try:
        # Manually load original
        if not hasattr(doc, "_original"):
            doc._original = frappe.get_doc(doc.doctype, doc.name)


        if doc.valuation_rate != doc._original.valuation_rate:
            if doc.custom_qbo_item_id:
                success = run_qbo_script("updateQboCost.ts", doc.name, str(doc.valuation_rate))
                if success:
                    pass
                    # Save sync timestamp AFTER QBO update
                    #try:
                        #enqueue("qb_connector.qbo_hooks.mark_qbo_synced", item_name=doc.name)
                    #except Exception  as e:



    except Exception as e:
        frappe.logger().error(f"❌ Failed during QBO cost sync: {str(e)}")


def sync_qbo_price_on_update(doc, method):

    try:
        # Manually load original item price doc to compare the price list rate
        if not hasattr(doc, "_original"):
            doc._original = frappe.get_doc(doc.doctype, doc.name)

        # Check if the price list rate has changed
        if doc.price_list_rate != doc._original.price_list_rate:
            # Get the associated item using the item_code from the Item Price doc
            item = frappe.get_doc("Item", doc.item_code)  # Fetch the related item

            if item.custom_qbo_item_id:
                # Run the script to update the price in QBO
                success = run_qbo_script("updateQboPrice.ts", item.name, str(doc.price_list_rate))
                if success:
                    pass
                    # Save sync timestamp AFTER QBO update
                
    except Exception as e:
        frappe.logger().error(f"❌ Failed during QBO price sync: {str(e)}")

