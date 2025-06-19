console.log("📦 Loaded: sales_invoice_list.js");

// 👇 Reusable button logic
function inject_retry_button(listview) {
    if (listview.retry_button_added) return;

    console.log("✅ Injecting Retry Failed QBO Syncs button");

    let button = listview.page.add_inner_button("Retry Failed QBO Syncs", async () => {
        console.log("🔁 Retry button clicked");

        // ⛔ Disable and show spinner
        button.prop("disabled", true).html(`<i class="fa fa-spinner fa-spin"></i> Retrying...`);

        try {
            // 🌀 First call: refresh token
            await frappe.call({ method: "qb_connector.api.refresh_qbo_token" });

            // 🧾 Second call: retry failed syncs
            const r = await frappe.call({
                method: "qb_connector.invoice_hooks.retry_failed_invoice_syncs"
            });
            
            button.prop("disabled", false).html("Retry Failed QBO Syncs");
            listview.refresh();
            
        } catch (error) {
            frappe.msgprint("❌ Retry failed.");
            console.error("Retry error:", error);
            button.prop("disabled", false).html("Retry Failed QBO Syncs");
        }
    });

    listview.retry_button_added = true;
}

// 👇 Register hook for Sales Invoice List
frappe.listview_settings["Sales Invoice"] = {
    onload(listview) {
        console.log("📃 onload triggered from listview_settings");
        inject_retry_button(listview);
    }
};

// 👇 Fallback in case onload misses
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
