import frappe
import subprocess
import json
import os
from frappe.utils import now_datetime
import qb_connector.api

# ========== Hook: Sync Sales Invoice to QBO ==========
def sync_sales_invoice_to_qbo(doc, method):
    print(f"🚨 Hook triggered for Sales Invoice: {doc.name}")
    frappe.logger().info(f"🚨 Hook triggered for Sales Invoice: {doc.name}")

    try:
        print("🔧 Starting QBO script execution...")
        #The .ts function will return the qbo sales invoice id if it succeeds or -1 if it fails
        invoice_id = run_qbo_script("syncInvoiceToQbo.ts", doc.name)

        if invoice_id >= 0:
            status = "Synced"
        else:
            status = "Failed"
            invoice_id = None

        print(f"📨 Enqueuing sync status update → {status}")
        if invoice_id:
            frappe.enqueue("qb_connector.qbo_hooks.mark_qbo_sync_status",
                        doctype=doc.doctype,
                        docname=doc.name,
                        status=status,
                        invoice_id=invoice_id)
        else: 
            frappe.enqueue("qb_connector.qbo_hooks.mark_qbo_sync_status",
                doctype=doc.doctype,
                docname=doc.name,
                status=status)

        print(f"🧾 Enqueued Sales Invoice sync status update for {doc.name}")
        frappe.logger().info(f"🧾 Enqueued Sales Invoice sync status update → {status}")
    except Exception as e:
        print(f"❌ Error in sync_sales_invoice_to_qbo: {e}")
        frappe.logger().error(f"❌ Sales Invoice sync failed: {str(e)}")


def run_qbo_script(script_name: str, docname: str) -> int:
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

            # Try to parse the QBO Invoice ID from stdout
            try:
                # Assuming the script returns the QBO Invoice ID as a number (or string that can be cast to int)
                invoice_id = int(stdout.strip())  # Return parsed QBO Invoice ID
                return invoice_id
            except ValueError:
                # If parsing fails, log the error and return -1
                print(f"❌ Failed to parse QBO Invoice ID from stdout: {stdout}")
                return -1

        if stderr:
            print(f"❗ STDERR:\n{stderr}")
            frappe.logger().error(f"[Invoice Sync Error] {stderr}")

        return -1  # Return -1 if no valid output was found in stdout

    except Exception as e:
        print(f"❌ Exception during script execution: {e}")
        frappe.logger().error(f"❌ Exception in run_qbo_script: {str(e)}")
        return -1  # Return -1 on failure


@frappe.whitelist()
def retry_failed_invoice_syncs():
    # your actual logic
    resynced_count = 0

    failed_invoices = frappe.get_all("Sales Invoice", filters={"custom_sync_status": "Failed"}, fields=["name"])
    for inv in failed_invoices:
        try:
            # call your actual sync function
            sync_sales_invoice_to_qbo(frappe.get_doc("Sales Invoice", inv.name), "manual_retry")
            resynced_count += 1
        except Exception as e:
            frappe.log_error(str(e), f"Retry failed for {inv.name}")

    return {
        "message": f"✅ Resynced {resynced_count} invoice(s).",
        "refresh": resynced_count > 0
    }