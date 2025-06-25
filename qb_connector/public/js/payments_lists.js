console.log("📦 Loaded: payment_list.js");

// 👇 Reusable button logic
function inject_sync_button(listview) {
    if (listview.retry_button_added) return;

    console.log("✅ Injecting Sync QBO Payments button");

    let button = listview.page.add_inner_button("Sync Payments From QBO", async () => {
        console.log("🔁 Retry button clicked");

        // ⛔ Disable and show spinner
        button.prop("disabled", true).html(`<i class="fa fa-spinner fa-spin"></i> Retrying...`);

        try {
            // 🌀 First call: refresh token
            await frappe.call({ method: "qb_connector.api.refresh_qbo_token" });

            // 🧾 Second call: retry failed syncs
            const r = await frappe.call({
                method: "qb_connector.payment_hooks.sync_payments_from_qbo"
            });
            
            button.prop("disabled", false).html("Sync Payments From QBO");
            listview.refresh();
            
        } catch (error) {
            frappe.msgprint("❌ Retry failed.");
            console.error("Retry error:", error);
            button.prop("disabled", false).html("Sync Payments From QBO");
        }
    });

    listview.retry_button_added = true;
}

function inject_retry_button(listview) {
    if (listview.sync_button_added) return;

    console.log("✅ Injecting Retry Syncing Failed Payments button");

    let button = listview.page.add_inner_button("Retry Syncing Failed Payments", async () => {
        console.log("🔁 Retry button clicked");

        // ⛔ Disable and show spinner
        button.prop("disabled", true).html(`<i class="fa fa-spinner fa-spin"></i> Retrying...`);

        try {
            // 🌀 First call: refresh token
            await frappe.call({ method: "qb_connector.api.refresh_qbo_token" });

            // 🧾 Second call: retry failed syncs
            const r = await frappe.call({
                method: "qb_connector.payment_hooks.retry_failed_payment_syncs"
            });
            
            button.prop("disabled", false).html("Retry Syncing Failed Payments");
            listview.refresh();
            
        } catch (error) {
            frappe.msgprint("❌ Retry failed.");
            console.error("Retry error:", error);
            button.prop("disabled", false).html("Retry Syncing Failed Payments");
        }
    });

    listview.sync_button_added = true;
}

// 👇 Register hook for Sales Invoice List
frappe.listview_settings["Payment Entry"] = {
    onload(listview) {
        console.log("📃 onload triggered from listview_settings");
        inject_retry_button(listview);
        inject_sync_button(listview);
    }
};

// 👇 Fallback in case onload misses
frappe.after_ajax(() => {
    setTimeout(() => {
        if (
            frappe.router.current_route?.[1] === "Payment Entry" &&
            typeof cur_list !== "undefined" &&
            cur_list.page
        ) {
            console.log("⚡ Fallback injection on cur_list");
            inject_retry_button(cur_list);
            inject_sync_button(cur_list);
        }
    }, 200);
});
