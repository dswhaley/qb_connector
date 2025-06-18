import frappe

def create_shipment_tracker(doc, method):
    if frappe.db.exists("Shipment Tracker", {"sales_order": doc.name}):
        return  # Already created
    customer_name = doc.customer
    if not customer_name:
        return
    customer = frappe.get_doc("Customer", customer_name)
    shipmentName = f"{customer_name} order {doc.name}"
    camp_link = customer.custom_camp_link or ""
    tracker = frappe.new_doc("Shipment Tracker")
    tracker.name = shipmentName
    tracker.sales_order = doc.name
    tracker.shipment_status = "Sales Order Made"
    tracker.shipment_name = shipmentName
    tracker.custom_camp = customer.custom_camp_link
    
    tracker.insert()
    frappe.db.commit()

def link_invoice_to_tracker(doc, method):
    if not doc.items or not doc.items[0].sales_order:
        return

    sales_order = doc.items[0].sales_order
    tracker = frappe.get_value("Shipment Tracker", {"sales_order": sales_order}, "name")
    if not tracker:
        return

    st = frappe.get_doc("Shipment Tracker", tracker)
    st.sales_invoice = doc.name
    st.shipment_status = "Invoice Sent"
    st.save()
    frappe.db.commit()

def link_payment_to_tracker(doc, method):
    for ref in doc.references:
        if ref.reference_doctype == "Sales Invoice":
            invoice = ref.reference_name
            invoice_doc = frappe.get_doc("Sales Invoice", invoice)
            if not invoice_doc.items or not invoice_doc.items[0].sales_order:
                continue

            sales_order = invoice_doc.items[0].sales_order
            tracker = frappe.get_value("Shipment Tracker", {"sales_order": sales_order}, "name")
            if not tracker:
                continue

            st = frappe.get_doc("Shipment Tracker", tracker)
            st.payment_entry = doc.name
            st.shipment_status = "Payment Received"
            st.save()
            frappe.db.commit()
