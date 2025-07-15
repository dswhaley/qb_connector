import frappe
# ========== Validation: Ensure customer discount is sane ==========
def validate_customer_discount(doc, method):
    print("✅ Validate Customer Hook Started")
    customer_name = doc.customer
    if not customer_name:
        return

    customer = frappe.get_doc("Customer", customer_name)
    discount = customer.get("custom_discount_")

    try:
        discount_val = float(discount)
        if discount_val < 0 or discount_val > 100:
            frappe.throw(f"🚫 Invalid custom discount for '{customer_name}': {discount_val}%. Must be between 0 and 100.")
    except (TypeError, ValueError):
        frappe.throw(f"🚫 Custom discount for '{customer_name}' must be a number between 0 and 100.")


# ========== Dynamic Discount Logic ==========
def apply_dynamic_discount(doc, method):
    if not doc.custom_ignore_discount:
        customer_name = doc.customer
        if not customer_name:
            return

        total_qty = doc.total_qty or 0
        discount_modifier = get_qty_discount_modifier(total_qty)

        customer = frappe.get_doc("Customer", customer_name)
        base_discount = float(customer.get("custom_discount_") or 0)

        total_discount_percentage = base_discount + discount_modifier
        
        if not doc.is_new() and not hasattr(doc, "_original"):
            doc._original = frappe.get_doc(doc.doctype, doc.name)
        
        if (doc.is_new() and not doc.additional_discount_percentage) or (hasattr(doc, "_original") and doc._original.additional_discount_percentage != total_discount_percentage):
            # Set standard ERPNext discount fields
            doc.apply_discount_on = "Net Total"
            doc.additional_discount_percentage = total_discount_percentage
            #doc.additional_discount_amount = 0  # Let ERPNext calculate this

            doc.calculate_taxes_and_totals()

            frappe.msgprint(f"✅ Applied total discount of {total_discount_percentage:.2f}%")
    else:
        doc.apply_discount_on = "Net Total"
        doc.additional_discount_percentage = 0
        doc.discount_amount = 0
        doc.calculate_taxes_and_totals()

        print("Discounting Skipped due to ignore_discount checkbox")


def get_qty_discount_modifier(qty):
    if qty >= 10000: return 20
    if qty >= 4000: return 17
    if qty >= 3000: return 15
    if qty >= 2000: return 12
    if qty >= 1500: return 10
    if qty >= 1200: return 7
    if qty >= 800: return 5
    if qty >= 500: return 2
    return 0


#