console.log("📦 Loaded: items.js");

// 👇 Reusable button logic
function inject_retry_button(listview) {
    if (listview.retry_button_added) return;

    console.log("✅ Injecting Fetch QBO Items Button");

    let button = listview.page.add_inner_button("Fetch QBO Items", async () => {
        console.log("🔁 Button Clicked");

        // ⛔ Disable and show spinner
        button.prop("disabled", true).html(`<i class="fa fa-spinner fa-spin"></i> Syncing...`);

        try {
            // 🌀 First call: refresh token
            await frappe.call({ method: "qb_connector.qbo_hooks.sync_items_from_qbo" });

            button.prop("disabled", false).html("Fetch QBO Items");

            listview.refresh();
        } catch (error) {
            frappe.msgprint("❌ Retry failed.");
            console.error("Retry error:", error);
            button.prop("disabled", false).html("Fetch QBO Items");
        }
    });

    listview.retry_button_added = true;
}

// 👇 Register hook for Sales Invoice List
frappe.listview_settings["Item"] = {
    onload(listview) {
        console.log("📃 onload triggered from listview_settings");
        inject_retry_button(listview);
    }
};

// 👇 Fallback in case onload misses
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
