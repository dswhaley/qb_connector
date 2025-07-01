import frappe
from .discount_hooks import apply_dynamic_discount, get_qty_discount_modifier, validate_customer_discount

# ========== Sales Order Hook ==========
def sales_order_hooks(doc, method):
    apply_dynamic_discount(doc, method)
    use_tax_status(doc, method)

# ========== Tax Status Application ==========
def use_tax_status(doc, method):
    try:
        customer = frappe.get_doc("Customer", doc.customer)
    
    
        print(f"Tax Status: {customer.custom_tax_status}\n State Status: {get_state_tax_status(customer)}")
        if customer.custom_tax_status == "Exempt" or get_state_tax_status(customer) == 0:
            doc.exempt_from_sales_tax = 1
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
    

