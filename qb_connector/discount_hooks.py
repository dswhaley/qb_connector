
import frappe

# ========== Validation: Ensure customer discount is sane ========== 
def validate_customer_discount(doc, method):
    """
    Validates that the custom discount for a customer is a number between 0 and 100.
    Throws an error if the discount is missing, not a number, or out of bounds.
    Args:
        doc: The document being validated (usually Sales Invoice or similar).
        method: The event method triggering the hook.
    """
    print("✅ Validate Customer Hook Started")
    customer_name = doc.customer  # Get the customer name from the document
    if not customer_name:
        # If no customer is set, nothing to validate
        return

    customer = frappe.get_doc("Customer", customer_name)  # Fetch the Customer DocType
    discount = customer.get("custom_discount_")  # Get the custom discount field

    try:
        discount_val = float(discount)  # Try converting discount to float
        if discount_val < 0 or discount_val > 100:
            # Discount must be between 0 and 100 percent
            frappe.throw(f"🚫 Invalid custom discount for '{customer_name}': {discount_val}%. Must be between 0 and 100.")
    except (TypeError, ValueError):
        # Discount is not a valid number
        frappe.throw(f"🚫 Custom discount for '{customer_name}' must be a number between 0 and 100.")



# ========== Dynamic Discount Logic ========== 
def apply_dynamic_discount(doc, method):
    """
    Applies a dynamic discount to the document based on the customer's base discount
    and the total quantity of items. If the 'ignore discount' flag is set, disables discounting.
    Args:
        doc: The document being processed (e.g., Sales Invoice).
        method: The event method triggering the hook.
    """
    if not doc.custom_ignore_discount:
        # Only apply discount if 'ignore discount' is not checked
        customer_name = doc.customer
        if not customer_name:
            # No customer, nothing to do
            return

        total_qty = doc.total_qty or 0  # Get total quantity from the document
        discount_modifier = get_qty_discount_modifier(total_qty)  # Get extra discount based on quantity

        customer = frappe.get_doc("Customer", customer_name)  # Fetch the Customer DocType
        base_discount = float(customer.get("custom_discount_") or 0)  # Get base discount, default to 0

        total_discount_percentage = base_discount + discount_modifier  # Sum base and modifier

        # For non-new docs, store the original for comparison
        if not doc.is_new() and not hasattr(doc, "_original"):
            doc._original = frappe.get_doc(doc.doctype, doc.name)

        # Only update discount if it's a new doc or the discount has changed
        if (doc.is_new() and not doc.additional_discount_percentage) or (hasattr(doc, "_original") and doc._original.additional_discount_percentage != total_discount_percentage):
            # Set ERPNext discount fields
            doc.apply_discount_on = "Net Total"  # Apply discount on net total
            doc.additional_discount_percentage = total_discount_percentage  # Set the calculated discount
            # doc.additional_discount_amount = 0  # Let ERPNext calculate this automatically

            doc.calculate_taxes_and_totals()  # Recalculate totals after discount

            frappe.msgprint(f"✅ Applied total discount of {total_discount_percentage:.2f}%")
    else:
        # If 'ignore discount' is checked, set discount fields to zero
        doc.apply_discount_on = "Net Total"
        doc.additional_discount_percentage = 0
        doc.discount_amount = 0
        doc.calculate_taxes_and_totals()

        print("Discounting Skipped due to ignore_discount checkbox")



def get_qty_discount_modifier(qty):
    """
    Returns an additional discount percentage based on the total quantity ordered.
    The more items ordered, the higher the discount modifier.
    Args:
        qty (int or float): The total quantity of items.
    Returns:
        int: The discount modifier percentage.
    """
    # These thresholds are business rules for quantity-based discounts
    if qty >= 10000: return 20  # 20% for 10,000+
    if qty >= 4000: return 17   # 17% for 4,000+
    if qty >= 3000: return 15   # 15% for 3,000+
    if qty >= 2000: return 12   # 12% for 2,000+
    if qty >= 1500: return 10   # 10% for 1,500+
    if qty >= 1200: return 7    # 7% for 1,200+
    if qty >= 800: return 5     # 5% for 800+
    if qty >= 500: return 2     # 2% for 500+
    return 0  # No extra discount for less than 500



# End of discount_hooks.py