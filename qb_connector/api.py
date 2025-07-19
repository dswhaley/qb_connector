# qb_connector/api.py

import frappe
import requests
from frappe import _
from frappe.utils.password import get_decrypted_password
import qb_connector.qbo_hooks 


@frappe.whitelist(allow_guest=True)
def handle_qbo_callback(code=None, realmId=None):
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
    frappe.logger().info("✅ test_scheduler_job executed successfully")


def customer_update_handler(doc, method):
    if (doc.custom_camp_link or doc.custom_other_organization_link) and doc.custom_email and doc.custom_phone and doc.custom_billing_address and (doc.custom_tax_status == "Taxed" or (doc.custom_tax_status == "Exempt" and doc.custom_tax_exemption_number)):
        doc.custom_create_customer_in_qbo = 1
    if doc.custom_create_customer_in_qbo == 0:
        doc.custom_create_customer_in_qbo = 0
        return
    if not doc.custom_camp_link and not doc.custom_other_organization_link:
        doc.custom_qbo_sync_status = "Missing Organization Link"
        doc.custom_create_customer_in_qbo = 0
        frappe.msgprint("Cannot Create Customer due to Missing Organization Link")
        return

    try:
        organization = None
        if doc.custom_camp_link and frappe.db.exists("Camp", {"name": doc.custom_camp_link}):
            organization = frappe.get_doc("Camp", doc.custom_camp_link)
        elif doc.custom_other_organization_link and frappe.db.exists("Other Organization", {"name": doc.custom_other_organization_link}):
            organization = frappe.get_doc("Other Organization", doc.custom_other_organization_link)
        else:
            frappe.msgprint("Customer not linked to a Camp or an Organization")
            return
        
    except Exception as e:
        doc.custom_qbo_sync_status = "Invalid Organization Link"
        doc.custom_create_customer_in_qbo = 0
        frappe.log_error(f"Invalid Organization Link on Customer {doc.name}: {e}", "QBO Sync Error")
        frappe.msgprint(f"Customer: {doc.name} has an invalid Organizaton Link")
        return

    if organization.tax_exempt == "Pending":
        doc.custom_qbo_sync_status = "Tax Status Pending"
        doc.custom_create_customer_in_qbo = 0
        frappe.msgprint(f"Customer: {doc.name} not created in QBO because 'Tax Status Pending'")
        return

    if organization.tax_exempt == "Exempt" and not organization.tax_exemption_number:
        doc.custom_qbo_sync_status = "Missing Tax Exemption Number"
        doc.custom_create_customer_in_qbo = 0
        frappe.msgprint(f"Customer: {doc.name} not created in QBO because 'Missing Tax Exemption Number'")
        return

    print(f"Sync Status: {doc.custom_qbo_sync_status}")
    if doc.custom_qbo_sync_status != "Synced":
        try:
            response = requests.post(
                "http://localhost:3000/api/handle-customer-create",
                json={"customer_name": doc.name},
                timeout=5
            )

            if response.status_code != 200:
                doc.custom_create_customer_in_qbo = 0
                frappe.msgprint(f"❌ Failed to sync with QBO (HTTP {response.status_code})")
                return
            
            result = response.json()

            # ✅ Apply returned values to the doc
            doc.custom_qbo_sync_status = result.get("custom_qbo_sync_status", "Unknown")
            doc.custom_qbo_customer_id = result.get("custom_qbo_customer_id") or ""
            doc.custom_last_synced_at = result.get("custom_last_synced_at") or ""

            if doc.custom_qbo_sync_status == "Synced":
                frappe.msgprint(f"✅ Successfully synced {doc.name} to QBO.")
                doc.custom_customer_exists_in_qbo = 1
                doc.custom_create_customer_in_qbo = 0
            else:
                frappe.msgprint(f"⚠️ QBO Sync Result for {doc.name}: {doc.custom_qbo_sync_status}")

        except Exception as e:
            doc.custom_qbo_sync_status = "Failed"
            doc.custom_create_customer_in_qbo = 0
            frappe.log_error(f"Error during QBO sync for {doc.name}: {e}", "QBO Sync Error")
            frappe.msgprint(f"❌ Exception during QBO sync: {e}")
    else:
        doc.custom_create_customer_in_qbo = 0

# def customer_discount_update(doc, method):
#     # Get all Customers linked to this Camp
#     customers = frappe.get_all(
#         "Customer",
#         filters={"custom_camp_link": doc.name},
#         fields=["name"]
#     )
#     if not customers:
#         return

#     for cust in customers:
#         customer = frappe.get_doc("Customer", cust["name"])
#         customer.custom_discount_ = doc.association_discount
#         customer.save()
#         print(f"✅ Updated Customer {customer.name} with new discount: {doc.association_discount}")

