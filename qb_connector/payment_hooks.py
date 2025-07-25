import frappe
import subprocess
import os

# payment_hooks.py
# Hooks and helpers for syncing Payment Entry documents to QuickBooks Online (QBO).

def sync_payment_entry_to_qbo(doc, method):
    """
    Syncs a Payment Entry document to QuickBooks Online (QBO) by calling a Node.js TypeScript script.
    Updates the sync status in ERPNext based on the result.
    Args:
        doc: The Payment Entry document being submitted.
        method: The event method triggering the hook (e.g., 'on_submit').
    """
    print(f"🚨 Hook triggered for Payment Entry: {doc.name}")
    frappe.logger().info(f"🚨 Hook triggered for Payment Entry: {doc.name}")
    if not doc.custom_dont_sync_with_qbo:
        try:
            print("🔧 Starting QBO script execution...")
            payment_id = run_qbo_script("syncPaymentToQbo.ts", doc.name)

            if payment_id:
                status = "Synced"
                # Mark as synced so it doesn't sync again
                frappe.db.set_value("Payment Entry", doc.name, "custom_dont_sync_with_qbo", 1)
            else:
                status = "Failed"

            print(f"📨 Enqueuing sync status update → {status}")
            # Enqueue a background job to update sync status in ERPNext
            if payment_id:
                frappe.enqueue("qb_connector.payment_hooks.mark_qbo_sync_status",
                    doctype=doc.doctype,
                    docname=doc.name,
                    status=status,
                    payment_id=payment_id)
            else:
                frappe.enqueue("qb_connector.payment_hooks.mark_qbo_sync_status",
                    doctype=doc.doctype,
                    docname=doc.name,
                    status=status)

            print(f"🧾 Enqueued Payment Entry sync status update for {doc.name}")
            frappe.logger().info(f"🧾 Enqueued Payment Entry sync status update → {status}")
        except Exception as e:
            print(f"❌ Error in sync_payment_entry_to_qbo: {e}")
            frappe.logger().error(f"❌ Payment Entry sync failed: {str(e)}")
    else:
        print("Skipped because of custom_dont_sync_with_qbo")

@frappe.whitelist()
def retry_failed_payment_syncs():
    """
    Attempts to re-sync all Payment Entries that previously failed to sync to QBO.
    Returns a summary message and refresh flag.
    Returns:
        dict: Message and refresh status for the UI.
    """
    resynced_count = 0

    # Find all payment entries with sync status 'Failed'
    failed_invoices = frappe.get_all("Payment Entry", filters={"custom_sync_status": "Failed"}, fields=["name"])
    for pymt in failed_invoices:
        try:
            # Try to sync each failed payment again
            sync_payment_entry_to_qbo(frappe.get_doc("Payment Entry", pymt.name), "manual_retry")
            resynced_count += 1
        except Exception as e:
            frappe.log_error(str(e), f"Retry failed for {pymt.name}")

    return {
        "message": f"✅ Resynced {resynced_count} invoice(s).",
        "refresh": resynced_count > 0
    }

def run_qbo_script(script_name: str, docname: str = None) -> str | None:
    """
    Runs a Node.js TypeScript script to sync a Payment Entry to QBO.
    Returns True if successful, False otherwise.
    Args:
        script_name (str): The TypeScript script filename to run.
        docname (str, optional): The name of the Payment Entry document to sync.
    Returns:
        bool: True if sync succeeded, False otherwise.
    """
    try:
        # Determine the script directory and path
        current_dir = os.path.dirname(os.path.abspath(__file__))
        app_root = os.path.abspath(os.path.join(current_dir, ".."))
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
    """
    Sets last_synced and sync_status after QBO update for Payment Entry.
    Also updates the custom_qbo_payment_id if provided.
    Args:
        doctype (str): The DocType name (should be 'Payment Entry').
        docname (str): The name of the Payment Entry document.
        status (str): The sync status ('Synced' or 'Failed').
        payment_id (str, optional): The QBO Payment ID if available.
    """
    try:
        doc = frappe.get_doc(doctype, docname)
        doc.db_set("custom_sync_status", status)
        if status != "Synced":
            frappe.msgprint(f"Failed to Sync: {status}")
        # Only update the custom_qbo_payment_id if payment_id is provided
        if payment_id:
            doc.db_set("custom_qbo_payment_id", payment_id)
        # Save the document with the updated fields
        doc.save()
    except Exception as e:
        frappe.logger().error(f"❌ Failed to update sync status for {doctype} {docname}: {str(e)}")
        print(f"❌ Error in mark_qbo_sync_status: {e}")

