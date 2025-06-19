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

