# qb_connector/api.py

import frappe
import requests
from frappe import _
from frappe.utils.password import get_decrypted_password

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

def refresh_qbo_token():
    frappe.logger().info("🔄 Scheduler: Running refresh_qbo_token")
    try:
        settings_name = frappe.db.get_value("QuickBooks Settings", {}, "name")
        if not settings_name:
            return

        settings = frappe.get_doc("QuickBooks Settings", settings_name)

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
