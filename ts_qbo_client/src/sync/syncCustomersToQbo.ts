// src/syncCustomersToQbo.ts

import { frappe } from '../frappe';
import { syncCustomerToQbo } from './syncCustomerToQbo';

interface Customer {
  name: string;
  customer_name: string;
  custom_qbo_sync_status?: string;
}

async function main() {
  const allCustomers = await frappe.getAll<Customer>('Customer');

  const toSync = allCustomers.filter(
    (cust) => cust.custom_qbo_sync_status !== 'Synced'
  );

  console.log(`🔄 Found ${toSync.length} customers to sync\n`);

  const report = {
    matched: [] as string[],
    notFound: [] as string[],
    failed: [] as { name: string; reason: string }[],
  };

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
