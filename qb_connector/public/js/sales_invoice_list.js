// sales_invoice_list.js
// Adds a "Retry Failed QBO Syncs" button to the Sales Invoice list view in ERPNext, allowing users to trigger a retry for failed QBO syncs.

console.log("📦 Loaded: sales_invoice_list.js");

// 👇 Reusable button logic
function inject_retry_button(listview) {
    // Prevent adding the button multiple times
    if (listview.retry_button_added) return;

    console.log("✅ Injecting Retry Failed QBO Syncs button");

    // Add the button to the page header
    let button = listview.page.add_inner_button("Retry Failed QBO Syncs", async () => {
        console.log("🔁 Retry button clicked");

        // ⛔ Disable the button and show a spinner while retrying
        button.prop("disabled", true).html(`<i class="fa fa-spinner fa-spin"></i> Retrying...`);

        try {
            // 🌀 First call: refresh QBO token
            await frappe.call({ method: "qb_connector.api.refresh_qbo_token" });

            // 🧾 Second call: retry failed invoice syncs
            const r = await frappe.call({
                method: "qb_connector.invoice_hooks.retry_failed_invoice_syncs"
            });
            
            // ✅ Re-enable the button and restore its label
            button.prop("disabled", false).html("Retry Failed QBO Syncs");
            // 🔄 Refresh the list view to show updated invoices
            listview.refresh();
        } catch (error) {
            // ❌ Show error message and re-enable button
            frappe.msgprint("❌ Retry failed.");
            console.error("Retry error:", error);
            button.prop("disabled", false).html("Retry Failed QBO Syncs");
        }
    });

    // Mark that the button has been added to avoid duplicates
    listview.retry_button_added = true;
}

// 👇 Register hook for Sales Invoice List view
frappe.listview_settings["Sales Invoice"] = {
    onload(listview) {
        // Called when the Sales Invoice list view loads
        console.log("📃 onload triggered from listview_settings");
        inject_retry_button(listview);
    }
};

// 👇 Fallback in case onload misses (e.g., navigation quirks)
frappe.after_ajax(() => {
    setTimeout(() => {
        if (
            frappe.router.current_route?.[1] === "Sales Invoice" &&
            typeof cur_list !== "undefined" &&
            cur_list.page
        ) {
            console.log("⚡ Fallback injection on cur_list");
            inject_retry_button(cur_list);
        }
    }, 200);
});
