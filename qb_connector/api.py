# qb_connector/api.py

import frappe
import requests
from frappe import _

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
