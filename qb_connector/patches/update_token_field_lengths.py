import frappe

def execute():
    frappe.db.sql("""
        ALTER TABLE `tabQuickBooks Settings`
        MODIFY `accesstoken` VARCHAR(2048),
        MODIFY `refreshtoken` VARCHAR(2048)
    """)