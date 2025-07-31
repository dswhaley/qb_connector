import frappe

# shipment_hooks.py
# Hooks and helpers for creating and updating Shipment Tracker documents based on Sales Orders, Invoices, and Payments.

def create_shipment_tracker(doc, method):
    """
    Creates a Shipment Tracker document when a Sales Order is submitted, if one does not already exist.
    Links the tracker to the customer and organization type.
    Args:
        doc: The Sales Order document being submitted.
        method: The event method triggering the hook.
    """
    if frappe.db.exists("Shipment Tracker", {"sales_order": doc.name}):
        return  # Already created
    customer_name = doc.customer
    if not customer_name:
        return
    customer = frappe.get_doc("Customer", customer_name)
    shipmentName = f"{customer_name} order {doc.name}"

    organization_type = None
    if customer.custom_camp_link:
        organization_type = "Camp"
    elif customer.custom_other_organization_link:
        organization_type = "Other Organization"
    else:
        frappe.msgprint(f"Customer {customer.name} does not have an organization type")
        return

    tracker = frappe.new_doc("Shipment Tracker")
    tracker.name = shipmentName
    tracker.sales_order = doc.name
    tracker.organization_type = organization_type
    tracker.shipment_status = "Sales Order Made"
    tracker.shipment_name = shipmentName
    tracker.organization = customer.name
    set_organization_info(tracker, organization_type, customer.name)
    
    tracker.insert()  # Insert the new Shipment Tracker into the database
    frappe.db.commit()  # Commit the transaction to persist changes


def set_organization_info(tracker, organization_type, customer_name):
    """
    Sets organization-related shipping address fields on the Shipment Tracker.
    Args:
        tracker: The Shipment Tracker document being updated.
        organization_type (str): Either 'Camp' or 'Other Organization'.
        customer_name (str): The name of the customer.
    """
    organization = frappe.get_doc(organization_type, customer_name)
    tracker.order_id = organization.organization_order_id
    tracker.street_address_line_1 = organization.street_address_line_1_shipping_address
    tracker.street_address_line_2 = organization.street_address_line_2_shipping_address
    tracker.city = organization.city_shipping_address
    tracker.state = organization.state_shipping_address
    tracker.zip_code = organization.zip_code_shipping_address
    tracker.country = organization.country_shipping_address
    


def link_invoice_to_tracker(doc, method):
    """
    Links a submitted Sales Invoice to the corresponding Shipment Tracker, updating its status.
    Args:
        doc: The Sales Invoice document being submitted.
        method: The event method triggering the hook.
    """
    if not doc.items or not doc.items[0].sales_order:
        return

    sales_order = doc.items[0].sales_order
    tracker = frappe.get_value("Shipment Tracker", {"sales_order": sales_order}, "name")
    if not tracker:
        return

    st = frappe.get_doc("Shipment Tracker", tracker)
    st.sales_invoice = doc.name
    st.shipment_status = "Invoice Sent"
    st.save()  # Save changes to Shipment Tracker
    frappe.db.commit()  # Commit the transaction


def link_payment_to_tracker(doc, method):
    """
    Links a submitted Payment Entry to the corresponding Shipment Tracker, updating its status.
    Args:
        doc: The Payment Entry document being submitted.
        method: The event method triggering the hook.
    """
    for ref in doc.references:
        if ref.reference_doctype == "Sales Invoice":
            invoice = ref.reference_name
            frappe.logger().debug(f"Fetching Sales Invoice doc: {invoice}")
            try:
                invoice_doc = frappe.get_doc("Sales Invoice", invoice)
            except Exception as e:
                frappe.msgprint(f"Error fetching Sales Invoice {invoice}: {e}")
                continue

            # Look for a Shipment Tracker that directly references this Sales Invoice
            tracker_name = frappe.get_value("Shipment Tracker", {"sales_invoice": invoice}, "name")
            if not tracker_name:
                frappe.logger().debug(f"No Shipment Tracker found for Sales Invoice {invoice}")
                continue

            try:
                tracker_doc = frappe.get_doc("Shipment Tracker", tracker_name)
                tracker_doc.payment_entry = doc.name
                tracker_doc.shipment_status = "Payment Received"
                tracker_doc.save()  # Save changes to Shipment Tracker
                frappe.db.commit()  # Commit the transaction
                frappe.logger().debug(f"Shipment Tracker {tracker_name} updated with payment_entry {doc.name} and status 'Payment Received'")
            except Exception as e:
                frappe.logger().error(f"Error updating Shipment Tracker {tracker_name}: {e}")
                frappe.msgprint(f"Error updating Shipment Tracker {tracker_name}: {e}")
