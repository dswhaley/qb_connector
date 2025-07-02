import frappe
from .discount_hooks import apply_dynamic_discount, get_qty_discount_modifier, validate_customer_discount

#This file is called by both Sales Invoices and Sales Order

# ========== Sales Order Hook ==========
def order_hooks(doc, method):
    check_negotiated_items(doc, method)
    apply_dynamic_discount(doc, method)
    use_tax_status(doc, method)

# ========== Tax Status Application ==========
def use_tax_status(doc, method):
    try:
        customer = frappe.get_doc("Customer", doc.customer)
    
    
        print(f"Tax Status: {customer.custom_tax_status}\n State Status: {get_state_tax_status(customer)}")
        if customer.custom_tax_status == "Exempt" or get_state_tax_status(customer) == 0:
            doc.exempt_from_sales_tax = 1
            doc.taxes_and_charges = None
            doc.set("taxes", [])
            doc.total_taxes_and_charges = 0

        else:
            doc.exempt_from_sales_tax = 0

    except Exception as e:
        raise ValueError(f"❌ Doc does not have a valid customer link: {str(e)}")



def get_state_tax_status(customer):
    try:
        parts = customer.custom_billing_address.split(",")
        state = parts[2].strip().lower()
        print(f"📂 State: {state}")
    except Exception:
        raise ValueError("❌ Invalid billing address format (expected at least 3 parts: 'Street, City, State').")
    
    state_info = frappe.get_doc("State Tax Information", "State Tax Information")

    meta = frappe.get_meta("State Tax Information")
    if any(df.fieldname == state for df in meta.fields):
        return state_info.get(state)
    else:
        raise ValueError(f"❌ Invalid State: field '{state}' not found in State Tax Information.")
    
def check_negotiated_items(doc, method):
    try:
        customer = frappe.get_doc("Customer", doc.customer)
        camp = frappe.get_doc("Camp", customer.custom_camp_link)

        if camp.negotiated_wristband:
            if camp.negotiated_wristband_price:
                search_order_and_update_price(doc, camp.negotiated_wristband, camp.negotiated_wristband_price)
            else:
                frappe.msgprint("Customer has a negotiated wristband, but no negotiated writband price")

        if camp.negotiated_regular_account:
            if camp.negotiated_regular_account_price:
                search_order_and_update_price(doc, camp.negotiated_regular_account, camp.negotiated_regular_account_price)
            else:
                frappe.msgprint("Customer has a negotiated account, but no negotiated account price")

        if camp.negotiated_staff_account:
            if camp.negotiated_staff_account_price:
                search_order_and_update_price(doc, camp.negotiated_staff_account, camp.negotiated_staff_account_price)
            else:
                frappe.msgprint("Customer has a negotiated account, but no negotiated account price")

            

    except Exception as e:
        frappe.msgprint(f"Failed due to: {str(e)}")

def search_order_and_update_price(order, target, new_price):
    for item in order.items:
        if item.item_code == target:
            if(item.rate != new_price):
                order.custom_ignore_discount = 1                        
                item.rate = new_price
                frappe.msgprint(f"{item.item_code} price changed to the negotiated price: ${new_price}")