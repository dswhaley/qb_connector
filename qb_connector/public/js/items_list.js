// items_list.js
// Adds a "Fetch QBO Items" button to the Item list view in ERPNext, allowing users to trigger a sync from QuickBooks Online.

console.log("📦 Loaded: items.js");

// 👇 Reusable button logic
function inject_retry_button(listview) {
    // Prevent adding the button multiple times
    if (listview.retry_button_added) return;

    console.log("✅ Injecting Fetch QBO Items Button");

    // Add the button to the page header
    let button = listview.page.add_inner_button("Fetch QBO Items", async () => {
        console.log("🔁 Button Clicked");

        // ⛔ Disable the button and show a spinner while syncing
        button.prop("disabled", true).html(`<i class="fa fa-spinner fa-spin"></i> Syncing...`);

        try {
            // 🌀 Call the backend method to sync items from QBO
            await frappe.call({ method: "qb_connector.qbo_hooks.sync_items_from_qbo" });

            // ✅ Re-enable the button and restore its label
            button.prop("disabled", false).html("Fetch QBO Items");

            // 🔄 Refresh the list view to show updated items
            listview.refresh();
        } catch (error) {
            // ❌ Show error message and re-enable button
            frappe.msgprint("❌ Retry failed.");
            console.error("Retry error:", error);
            button.prop("disabled", false).html("Fetch QBO Items");
        }
    });

    // Mark that the button has been added to avoid duplicates
    listview.retry_button_added = true;
}

// 👇 Register hook for Item List view
frappe.listview_settings["Item"] = {
    onload(listview) {
        // Called when the Item list view loads
        console.log("📃 onload triggered from listview_settings");
        inject_retry_button(listview);
    }
};

// 👇 Fallback in case onload misses (e.g., navigation quirks)
frappe.after_ajax(() => {
    setTimeout(() => {
        if (
            frappe.router.current_route?.[1] === "Item" &&
            typeof cur_list !== "undefined" &&
            cur_list.page
        ) {
            console.log("⚡ Fallback injection on cur_list");
            inject_retry_button(cur_list);
        }
    }, 200);
});
