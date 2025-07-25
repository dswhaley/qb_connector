// payments_lists.js
// Adds a "Retry Syncing Failed Payments" button to the Payment Entry list view in ERPNext, allowing users to trigger a retry for failed QBO syncs.

console.log("📦 Loaded: payment_list.js");

function inject_retry_button(listview) {
    // Prevent adding the button multiple times
    if (listview.sync_button_added) return;

    console.log("✅ Injecting Retry Syncing Failed Payments button");

    // Add the button to the page header
    let button = listview.page.add_inner_button("Retry Syncing Failed Payments", async () => {
        console.log("🔁 Retry button clicked");

        // ⛔ Disable the button and show a spinner while retrying
        button.prop("disabled", true).html(`<i class="fa fa-spinner fa-spin"></i> Retrying...`);

        try {
            // 🌀 First call: refresh QBO token
            await frappe.call({ method: "qb_connector.api.refresh_qbo_token" });

            // 🧾 Second call: retry failed payment syncs
            const r = await frappe.call({
                method: "qb_connector.payment_hooks.retry_failed_payment_syncs"
            });
            
            // ✅ Re-enable the button and restore its label
            button.prop("disabled", false).html("Retry Syncing Failed Payments");
            // 🔄 Refresh the list view to show updated payments
            listview.refresh();
        } catch (error) {
            // ❌ Show error message and re-enable button
            frappe.msgprint("❌ Retry failed.");
            console.error("Retry error:", error);
            button.prop("disabled", false).html("Retry Syncing Failed Payments");
        }
    });

    // Mark that the button has been added to avoid duplicates
    listview.sync_button_added = true;
}

// 👇 Register hook for Payment Entry List view
frappe.listview_settings["Payment Entry"] = {
    onload(listview) {
        // Called when the Payment Entry list view loads
        console.log("📃 onload triggered from listview_settings");
        inject_retry_button(listview);
        inject_sync_button(listview); // If you have another sync button logic
    }
};

// 👇 Fallback in case onload misses (e.g., navigation quirks)
frappe.after_ajax(() => {
    setTimeout(() => {
        if (
            frappe.router.current_route?.[1] === "Payment Entry" &&
            typeof cur_list !== "undefined" &&
            cur_list.page
        ) {
            console.log("⚡ Fallback injection on cur_list");
            inject_retry_button(cur_list);
            inject_sync_button(cur_list); // If you have another sync button logic
        }
    }, 200);
});
