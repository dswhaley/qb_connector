import frappe
from .discount_hooks import apply_dynamic_discount, get_qty_discount_modifier, validate_customer_discount

# order_hooks.py
# This file contains hooks and helpers for Sales Orders and Sales Invoices, including discount and tax logic.

# ========== Sales Order/Invoice Hook ==========
def order_hooks(doc, method):
    """
    Main hook called for Sales Orders and Sales Invoices.
    Applies negotiated item prices, dynamic discounts, and tax status logic.
    Args:
        doc: The document being processed (Sales Order or Sales Invoice).
        method: The event method triggering the hook.
    """
    check_negotiated_items(doc, method)  # Update item prices if negotiated
    apply_dynamic_discount(doc, method)  # Apply customer and quantity-based discounts
    use_tax_status(doc, method)  # Set tax exemption status

# ========== Tax Status Application ==========
def use_tax_status(doc, method):
    """
    Sets the 'exempt_from_sales_tax' flag and clears taxes if the customer is tax exempt
    or their state tax status is 0. Otherwise, leaves taxes as normal.
    Args:
        doc: The Sales Order or Invoice document.
        method: The event method triggering the hook.
    """
    try:
        # Fetch the linked customer document
        customer = frappe.get_doc("Customer", doc.customer)

        print(f"Tax Status: {customer.custom_tax_status}\n State Status: {get_state_tax_status(customer)}")
        # Exempt from sales tax if customer is marked 'Exempt' or state tax status is 0
        if customer.custom_tax_status == "Exempt" or get_state_tax_status(customer) == 0:
            doc.exempt_from_sales_tax = 1
            doc.taxes_and_charges = None  # Remove any taxes and charges
            doc.set("taxes", [])          # Clear taxes table
            doc.total_taxes_and_charges = 0
        else:
            doc.exempt_from_sales_tax = 0
    except Exception as e:
        raise ValueError(f"❌ Doc does not have a valid customer link: {str(e)}")


def get_state_tax_status(customer):
    """
    Looks up the state tax status for a customer based on their state field.
    Returns the value from the State Tax Information DocType if found, else False.
    Args:
        customer: The Customer document.
    Returns:
        int or bool: The state tax status value (usually 0 or 1), or False if not found.
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
        return False

def check_negotiated_items(doc, method):
    """
    Checks if the customer is linked to a Camp or Other Organization and applies negotiated prices
    for specific items (wristband, regular account, staff account) if set. Updates item prices in the order.
    Args:
        doc: The Sales Order or Invoice document.
        method: The event method triggering the hook.
    """
    try:
        # Only apply negotiated prices if the ignore flag is not set
        if not doc.custom_ignore_negotiated_price:
            customer = frappe.get_doc("Customer", doc.customer)
            organization = None
            # Determine which organization the customer is linked to
            if customer.custom_camp_link:
                organization = frappe.get_doc("Camp", customer.custom_camp_link)
            elif customer.custom_other_organization_link:
                organization = frappe.get_doc("Other Organization", customer.custom_other_organization_link)

            if organization is None:
                frappe.msgprint("Customer is not Linked to a Camp or an Organization")
                return

            # Check and apply negotiated wristband price
            if organization.negotiated_wristband:
                if organization.negotiated_wristband_price:
                    search_order_and_update_price(doc, organization.negotiated_wristband, organization.negotiated_wristband_price)
                else:
                    frappe.msgprint("Customer has a negotiated wristband, but no negotiated writband price")

            # Check and apply negotiated regular account price
            if organization.negotiated_regular_account:
                if organization.negotiated_regular_account_price:
                    search_order_and_update_price(doc, organization.negotiated_regular_account, organization.negotiated_regular_account_price)
                else:
                    frappe.msgprint("Customer has a negotiated account, but no negotiated account price")

            # Check and apply negotiated staff account price
            if organization.negotiated_staff_account:
                if organization.negotiated_staff_account_price:
                    search_order_and_update_price(doc, organization.negotiated_staff_account, organization.negotiated_staff_account_price)
                else:
                    frappe.msgprint("Customer has a negotiated account, but no negotiated account price")
    except Exception as e:
        frappe.msgprint(f"Failed due to: {str(e)}")

def search_order_and_update_price(order, target, new_price):
    """
    Searches the order's items for a specific item code and updates its price to the negotiated price.
    Also sets the 'ignore discount' flag to prevent further discounting on this item.
    Args:
        order: The Sales Order or Invoice document.
        target: The item code to search for.
        new_price: The negotiated price to set.
    """
    for item in order.items:
        if item.item_code == target:
            if item.rate != new_price:
                order.custom_ignore_discount = 1  # Prevent further discounting
                item.rate = new_price
                frappe.msgprint(f"{item.item_code} price changed to the negotiated price: ${new_price}")