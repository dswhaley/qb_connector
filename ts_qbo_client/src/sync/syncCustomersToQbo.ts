// src/syncCustomersToQbo.ts

// Import Frappe API wrapper
import { frappe } from '../frappe';
// Import function to sync a single customer to QBO
import { syncCustomerToQbo } from './syncCustomerToQbo';

/**
 * Interface representing a Frappe customer for batch sync
 */
interface Customer {
  name: string; // Frappe document name
  customer_name: string; // Customer display name
  custom_qbo_sync_status?: string; // QBO sync status
}

/**
 * Main batch sync function for customers
 */
async function main() {
  // Fetch all customers from Frappe
  const allCustomers = await frappe.getAll<Customer>('Customer');

  // Filter out customers that are already synced
  const toSync = allCustomers.filter(
    (cust) => cust.custom_qbo_sync_status !== 'Synced'
  );

  // Log how many customers need syncing
  console.log(`🔄 Found ${toSync.length} customers to sync\n`);

  // Initialize report object to track results
  const report = {
    matched: [] as string[], // Successfully matched and synced
    notFound: [] as string[], // No QBO match found
    failed: [] as { name: string; reason: string }[], // Sync failures
  };

  // Iterate through each customer to sync
  for (const customer of toSync) {
    try {
      const result = await syncCustomerToQbo(customer.name);

      if (result === 'matched') {
        report.matched.push(customer.name);
      } else if (result === 'not_found') {
        report.notFound.push(customer.name);
      }
    } catch (err: any) {
      const reason = err?.message || 'Unknown error';
      console.error(`❌ Failed to sync ${customer.name}:`, reason);
      report.failed.push({ name: customer.name, reason });
    }
  }

  // Summary
  console.log(`\n📊 Sync Summary:`);
  console.log(`✅ Matched: ${report.matched.length}`);
  console.log(`🔍 Not Found: ${report.notFound.length}`);
  console.log(`❌ Failed: ${report.failed.length}`);

  if (report.failed.length) {
    console.log('\n🧾 Failures:');
    for (const f of report.failed) {
      console.log(`- ${f.name}: ${f.reason}`);
    }
  }
}

if (require.main === module) {
  main()
    .then(() => console.log('\n✅ syncCustomersToQbo.ts complete'))
    .catch((err) => {
      console.error('🔥 Unhandled error in batch sync:', err);
      process.exit(1);
    });
}
