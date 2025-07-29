
# qb_connector/api.py
# API and event handler functions for QB Connector integration with QuickBooks Online and ERPNext.


import frappe
import requests
from frappe import _
from frappe.utils.password import get_decrypted_password
import qb_connector.qbo_hooks


@frappe.whitelist(allow_guest=True)
def handle_qbo_callback(code=None, realmId=None):
    """
    Handles the OAuth callback from QuickBooks Online.
    Exchanges the code and realmId for tokens via the Node.js server.
    Args:
        code (str): The authorization code from QBO.
        realmId (str): The company ID from QBO.
    Returns:
        dict: Status message indicating success or failure.
    """
    if not code or not realmId:
        frappe.throw(_("Missing code or realmId in the query parameters."))

    # The URL of your local Node.js server
    node_server_url = frappe.db.get_single_value("QuickBooks Settings", "node_server_url") or "http://localhost:3000"

    try:
        response = requests.get(f"{node_server_url}/auth/qbo/callback", params={
            "code": code,
            "realmId": realmId
        })
        response.raise_for_status()
        return {"status": "success", "message": "QBO connected."}
    except requests.exceptions.RequestException as e:
        frappe.log_error(str(e), "QBO Callback Failure")
        frappe.throw(_("Failed to handle QuickBooks callback."))
@frappe.whitelist()
def refresh_qbo_token():
    """
    Scheduled job to refresh the QuickBooks Online access token using the stored refresh token.
    Updates the QuickBooks Settings DocType with new tokens.
    """
    frappe.logger().info("🔄 Scheduler: Running refresh_qbo_token")
    try:
        settings = frappe.get_doc("QuickBooks Settings", "QuickBooks Settings")

        client_id = settings.clientid
        client_secret = settings.clientsecret
        refresh_token = settings.refreshtoken

        if not refresh_token:
            print("❌ Missing refresh token.")
            return

        token_url = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded"
        }
        payload = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token
        }

        response = requests.post(token_url, headers=headers, data=payload, auth=(client_id, client_secret))

        if response.status_code == 200:
            data = response.json()
            settings.accesstoken = data["access_token"]
            settings.refreshtoken = data["refresh_token"]
            settings.save()
            frappe.db.commit()
            print("Token Refresh Successfull")
        else:
            print(f"❌ Failed to refresh token. Response: {response.status_code} - {response.text}")
        frappe.logger().info("✅ Scheduler: Token refreshed successfully")
    except Exception as e:
        print(f"🔥 Exception occurred: {e}")
        frappe.log_error(frappe.get_traceback(), "QBO Token Refresh Error")

def test_scheduler_job():
    """
    Test function for scheduler jobs. Logs a message to verify scheduler execution.
    """
    frappe.logger().info("✅ test_scheduler_job executed successfully")


def customer_update_handler(doc, method):
    """
    Handles updates to Customer documents before save.
    Checks for required fields and organization links, manages QBO sync status,
    and triggers customer creation in QBO via Node.js server if needed.
    Args:
        doc: The Customer document being saved.
        method: The event method triggering the handler.
    """
    # Check if all required fields and links are present for QBO sync
    print(f"Camp link: {doc.custom_camp_link}\nOrganization link: {doc.custom_other_organization_link}\nEmail: {doc.custom_email}\nPhone: {doc.custom_phone}\nStreet Address: {doc.custom_street_address_line_1}\nCity: {doc.custom_city}\nState: {doc.custom_state}\nZip Code: {doc.custom_zip_code}\nCountry: {doc.custom_country}\nTax Status: {doc.custom_tax_status}\nTax Exemption Number: {doc.custom_tax_exemption_number}\nQBO Sync Status: {doc.custom_qbo_sync_status}")
    if (doc.custom_camp_link or doc.custom_other_organization_link) and doc.custom_email and doc.custom_phone and doc.custom_street_address_line_1 and doc.custom_city and doc.custom_state and doc.custom_zip_code and doc.custom_country and (doc.custom_tax_status == "Taxed" or (doc.custom_tax_status == "Exempt" and doc.custom_tax_exemption_number) and doc.custom_qbo_sync_status != "Synced"):
        doc.custom_create_customer_in_qbo = 1
    else:
        return
    if doc.custom_create_customer_in_qbo == 0:
        doc.custom_create_customer_in_qbo = 0
        return
    if not doc.custom_camp_link and not doc.custom_other_organization_link:
        doc.custom_qbo_sync_status = "Missing Organization Link"
        doc.custom_create_customer_in_qbo = 0
        frappe.msgprint("Cannot Create Customer due to Missing Organization Link")
        return

    try:
        if not doc.custom_camp_link and not doc.custom_other_organization_link:
            frappe.msgprint("Customer not linked to a Camp or an Organization")
            return
    except Exception as e:
        doc.custom_qbo_sync_status = "Invalid Organization Link"
        doc.custom_create_customer_in_qbo = 0
        frappe.log_error(f"Invalid Organization Link on Customer {doc.name}: {e}", "QBO Sync Error")
        frappe.msgprint(f"Customer: {doc.name} has an invalid Organizaton Link")
        return

    # Check for tax status requirements
    if doc.custom_tax_status == "Pending":
        doc.custom_qbo_sync_status = "Tax Status Pending"
        doc.custom_create_customer_in_qbo = 0
        frappe.msgprint(f"Customer: {doc.name} not created in QBO because 'Tax Status Pending'")
        return

    if doc.custom_tax_status == "Exempt" and not doc.custom_tax_exemption_number:
        doc.custom_qbo_sync_status = "Missing Tax Exemption Number"
        doc.custom_create_customer_in_qbo = 0
        frappe.msgprint(f"Customer: {doc.name} not created in QBO because 'Missing Tax Exemption Number'")
        return

    print(f"Sync Status: {doc.custom_qbo_sync_status}")
    if doc.custom_qbo_sync_status != "Synced":
        frappe.enqueue("qb_connector.api.sync_with_qbo", queue='default', timeout=300, now=False, doc=doc, is_async=True)
    else:
        doc.custom_create_customer_in_qbo = 0

def sync_with_qbo(doc):
    try:
        # Call Node.js server to create customer in QBO
        
        response = requests.post(
            "http://localhost:3000/api/handle-customer-create",
            json={"customer_name": doc.name},
            timeout=5
        )

        if response.status_code != 200:
            if not doc.custom_qbo_customer_id:

                doc.custom_create_customer_in_qbo = 0
                frappe.msgprint(f"❌ Failed to sync with QBO (HTTP {response.status_code})")
            else:
                doc.custom_qbo_sync_status = "Synced"
                doc.custom_create_customer_in_qbo = 0
                frappe.msgprint(f"Customer exists in QBO")
                doc.save(ignore_permissions=True)
            return

        result = response.json()

        # Apply returned values to the doc
        doc.custom_qbo_sync_status = result.get("custom_qbo_sync_status", "Unknown")
        doc.custom_qbo_customer_id = result.get("custom_qbo_customer_id") or ""
        doc.custom_last_synced_at = result.get("custom_last_synced_at") or ""

        if doc.custom_qbo_sync_status == "Synced":
            frappe.msgprint(f"✅ Successfully synced {doc.name} to QBO.")
            doc.custom_customer_exists_in_qbo = 1
            doc.custom_create_customer_in_qbo = 0
            doc.save(ignore_permissions=True)
        else:
            frappe.msgprint(f"⚠️ QBO Sync Result for {doc.name}: {doc.custom_qbo_sync_status}")
    except Exception as e:
        doc.custom_qbo_sync_status = "Failed"
        doc.custom_create_customer_in_qbo = 0
        frappe.log_error(f"Error during QBO sync for {doc.name}: {e}", "QBO Sync Error")
        frappe.msgprint(f"❌ Exception during QBO sync: {e}")
        doc.save(ignore_permissions=True)

def announce_synced(doc, method):
    if not doc.is_new():
        if not hasattr(doc, "_original"):
            doc._original = frappe.get_doc(doc.doctype, doc.name)
        print(f"Original Sync Status: {doc._original.custom_qbo_sync_status} - new Sync Status: {doc.custom_qbo_sync_status}")
        if doc._original.custom_qbo_sync_status != "Synced" and doc.custom_qbo_sync_status == "Synced":
            frappe.msgprint(f"✅ Customer {doc.name} has been successfully synced with QuickBooks Online.")