
import frappe
import subprocess
import json
import os
from frappe.utils import now_datetime
import qb_connector.api

# invoice_hooks.py
# Hooks and helpers for syncing Sales Invoices to QuickBooks Online (QBO) and handling tax logic.


# ========== Hook: Sync Sales Invoice to QBO ==========
def sync_sales_invoice_to_qbo(doc, method):
    """
    Syncs a Sales Invoice document to QuickBooks Online (QBO) by calling a Node.js TypeScript script.
    Updates the sync status in ERPNext based on the result.
    Args:
        doc: The Sales Invoice document being submitted.
        method: The event method triggering the hook (e.g., 'on_submit').
    """
    print(f"🚨 Hook triggered for Sales Invoice: {doc.name}")
    frappe.logger().info(f"🚨 Hook triggered for Sales Invoice: {doc.name}")

    try:
        print("🔧 Starting QBO script execution...")
        # Only sync if the 'don't sync' flag is not set
        if not doc.custom_dont_sync:
            # Run the TypeScript script to sync invoice to QBO
            invoice_id = run_qbo_script("syncInvoiceToQbo.ts", doc.name)

            # Determine sync status based on script result
            if invoice_id >= 0:
                status = "Synced"
            else:
                status = "Failed"
                invoice_id = None

            print(f"📨 Enqueuing sync status update → {status}")
            # Enqueue a background job to update sync status in ERPNext
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
        else:
            print("Not syncing due to don't sync flag")
    except Exception as e:
        print(f"❌ Error in sync_sales_invoice_to_qbo: {e}")
        frappe.logger().error(f"❌ Sales Invoice sync failed: {str(e)}")



def run_qbo_script(script_name: str, docname: str) -> int:
    """
    Runs a Node.js TypeScript script to sync a Sales Invoice to QBO.
    Returns the QBO Invoice ID if successful, or -1 on failure.
    Args:
        script_name (str): The TypeScript script filename to run.
        docname (str): The name of the Sales Invoice document to sync.
    Returns:
        int: The QBO Invoice ID, or -1 if sync failed.
    """
    try:
        # Determine the script directory and path
        current_dir = os.path.dirname(os.path.abspath(__file__))
        app_root = os.path.abspath(os.path.join(current_dir, ".."))
        script_dir = os.path.join(app_root, "ts_qbo_client", "src")
        script_path = os.path.join(script_dir, script_name)

        print(f"🔍 Script path: {script_path}")
        print(f"📦 Running: npx ts-node {script_path} {docname}")

        # Run the script using npx ts-node
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
                # The script should return the QBO Invoice ID as a number
                invoice_id = int(stdout.strip())
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
    """
    Attempts to re-sync all Sales Invoices that previously failed to sync to QBO.
    Returns a summary message and refresh flag.
    Returns:
        dict: Message and refresh status for the UI.
    """
    resynced_count = 0

    # Find all invoices with sync status 'Failed'
    failed_invoices = frappe.get_all("Sales Invoice", filters={"custom_sync_status": "Failed"}, fields=["name"])
    for inv in failed_invoices:
        try:
            # Try to sync each failed invoice again
            sync_sales_invoice_to_qbo(frappe.get_doc("Sales Invoice", inv.name), "manual_retry")
            resynced_count += 1
        except Exception as e:
            frappe.log_error(str(e), f"Retry failed for {inv.name}")

    return {
        "message": f"✅ Resynced {resynced_count} invoice(s).",
        "refresh": resynced_count > 0
    }



def use_tax_status(doc, method):
    """
    Sets the 'exempt_from_sales_tax' flag on the document based on the customer's tax status
    and state tax information. Used to determine if sales tax should be applied.
    Args:
        doc: The Sales Invoice document being processed.
        method: The event method triggering the hook.
    """
    try:
        # Fetch the linked customer document
        customer = frappe.get_doc("Customer", doc.customer)
    except Exception:
        raise ValueError("❌ Doc does not have a valid customer link.")

    print(f"Tax Status: {customer.custom_tax_status}\n State Status: {get_state_tax_status(customer)}")
    # Exempt from sales tax if customer is marked 'Exempt' or state tax status is 0
    if customer.custom_tax_status == "Exempt" or get_state_tax_status(customer) == 0:
        doc.exempt_from_sales_tax = 1
    else:
        doc.exempt_from_sales_tax = 0

def get_state_tax_status(customer):
    """
    Looks up the state tax status for a customer based on their state field.
    Returns the value from the State Tax Information DocType if found.
    Args:
        customer: The Customer document.
    Returns:
        int: The state tax status value (usually 0 or 1).
    Raises:
        ValueError: If the state field is not found or invalid.
    """
    try:
        state = customer.custom_state  # Get the state from the customer
        print(f"📂 State: {state}")
    except Exception:
        raise ValueError("❌ Invalid billing address format (expected at least 3 parts: 'Street, City, State').")

    state_info = frappe.get_doc("State Tax Information", "State Tax Information")

    meta = frappe.get_meta("State Tax Information")
    # Check if the state exists as a field in State Tax Information
    if any(df.fieldname == state for df in meta.fields):
        return state_info.get(state)
    else:
        raise ValueError(f"❌ Invalid State: field '{state}' not found in State Tax Information.")
    
