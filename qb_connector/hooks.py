app_name = "qb_connector"
app_title = "Qb Connector"
app_publisher = "funfangle"
app_description = "This app will connect to Quickbooks Online and will make Invoices in QB when an invoice is creatERPnext"
app_email = "danielwhaleygcc@gmail.com"
app_license = "mit"
from qb_connector.api_directory import qbo_webhooks

doctype_list_js = {
    "Sales Invoice": "public/js/sales_invoice_list.js",
    "Item": "public/js/items_list.js",
    "Payment Entry": "public/js/payments_lists.js"
}

# my_custom_app/hooks.py

fixtures = [
    # Custom DocTypes
    {
        "dt": "DocType",
        "filters": [
            ["name", "in", [
                "State Tax Information", 
                "QuickBooks Settings", 
                "Shipment Tracker"
            ]]
        ]
    },
    
    # Custom Fields
    {
        "dt": "Custom Field",
        "filters": [["dt", "in", [
            "Lead", 
            "Customer", 
            "Sales Invoice", 
            "Item", 
            "Tax Category", 
            "Payment Entry", 
            "Sales Order",
            "Shipment Tracker"
        ]]]
    },

    # Property Setters
    {
        "dt": "Property Setter",
        "filters": [["doc_type", "in", [
            "Lead", 
            "Customer", 
            "Sales Invoice", 
            "Item", 
            "Tax Category", 
            "Payment Entry", 
            "Sales Order"
        ]]]
    },

    # Workflow
    {
        "dt": "Workflow",
        "filters": [["document_type", "in", [
            "Lead", 
            "Customer", 
            "Sales Invoice", 
            "Item", 
            "Tax Category", 
            "Payment Entry", 
            "Sales Order"
        ]]]
    },

    # Print Format (if you have any custom print formats for the above DocTypes)
    {
        "dt": "Print Format",
        "filters": [["doc_type", "in", [
            "Lead", 
            "Customer", 
            "Sales Invoice", 
            "Item", 
            "Tax Category", 
            "Payment Entry", 
            "Sales Order"
        ]]]
    },

    # Workspaces
    {
        "doctype": "Workspace",
        "filters": [["name", "in", ["Shipments", "Taxes"]]]
    },

    # Tax Category Entries
    {
        "doctype": "Tax Category",
        "filters": [["name", "in", ["Taxable", "Not Taxable"]]]  # Modify to fit your tax categories
    },

    # Modules
    {
        "doctype": "Module Def",
        "filters": [["module_name", "in", [
            "Order Tracker", 
            "QB"
        ]]]
    },
    {
        "dt": "Item",
        "filters": [
            ["item_code", "=", "TEMP-PLACEHOLDER"]
        ]
    }
]




scheduler_events = {
    "hourly": [
        "qb_connector.api.refresh_qbo_token"
    ]
}
override_whitelisted_methods = {
    "qb_connector.api.handle_qbo_callback": "qb_connector.api.handle_qbo_callback"
}

doc_events = {
    "Customer": {
        "on_update": "qb_connector.api.customer_update_handler",
    },
    "Item": {
        "before_save": "qb_connector.qbo_hooks.sync_qbo_cost_on_update"
    },
    "Item Price": {
        "before_save": "qb_connector.qbo_hooks.sync_qbo_price_on_update"
    },
    "Sales Invoice": {
        "before_save": "qb_connector.order_hooks.order_hooks",
        "on_submit": [
            "qb_connector.invoice_hooks.sync_sales_invoice_to_qbo",
            "qb_connector.shipment_hooks.link_invoice_to_tracker"
        ] 
    },
    # "Camp":{
    #     "on_update": "qb_connector.api.customer_discount_update"
    # },
    "Sales Order": {
        "on_submit": "qb_connector.shipment_hooks.create_shipment_tracker",
        "before_save": "qb_connector.order_hooks.order_hooks"      
    },
    "Payment Entry": {
        "on_submit":[
            "qb_connector.shipment_hooks.link_payment_to_tracker",
            "qb_connector.payment_hooks.sync_payment_entry_to_qbo"
        ]
     }
}     


# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "qb_connector",
# 		"logo": "/assets/qb_connector/logo.png",
# 		"title": "Qb Connector",
# 		"route": "/qb_connector",
# 		"has_permission": "qb_connector.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/qb_connector/css/qb_connector.css"
# app_include_js = "/assets/qb_connector/js/qb_connector.js"

# include js, css files in header of web template
# web_include_css = "/assets/qb_connector/css/qb_connector.css"
# web_include_js = "/assets/qb_connector/js/qb_connector.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "qb_connector/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "qb_connector/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# automatically load and sync documents of this doctype from downstream apps
# importable_doctypes = [doctype_1]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "qb_connector.utils.jinja_methods",
# 	"filters": "qb_connector.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "qb_connector.install.before_install"
# after_install = "qb_connector.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "qb_connector.uninstall.before_uninstall"
# after_uninstall = "qb_connector.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "qb_connector.utils.before_app_install"
# after_app_install = "qb_connector.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "qb_connector.utils.before_app_uninstall"
# after_app_uninstall = "qb_connector.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "qb_connector.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"qb_connector.tasks.all"
# 	],
# 	"daily": [
# 		"qb_connector.tasks.daily"
# 	],
# 	"hourly": [
# 		"qb_connector.tasks.hourly"
# 	],
# 	"weekly": [
# 		"qb_connector.tasks.weekly"
# 	],
# 	"monthly": [
# 		"qb_connector.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "qb_connector.install.before_tests"

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "qb_connector.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "qb_connector.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["qb_connector.utils.before_request"]
# after_request = ["qb_connector.utils.after_request"]

# Job Events
# ----------
# before_job = ["qb_connector.utils.before_job"]
# after_job = ["qb_connector.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"qb_connector.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

