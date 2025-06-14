// src/findDiscountAccount.ts

import { getQboBaseUrl, getQboAuthHeaders } from "../auth";
import axios from "axios";

interface Account {
  Id: string;
  Name: string;
  AccountType: string;
  AccountSubType: string;
}

interface QueryResponse {
  QueryResponse: {
    Account?: Account[];
  };
}

async function main() {
  try {
    const baseUrl = await getQboBaseUrl();
    const headers = await getQboAuthHeaders();

    const query = `SELECT * FROM Account WHERE Name = 'Discounts given'`;
    const url = `${baseUrl}/query?query=${encodeURIComponent(query)}`;

    const response = await axios.get(url, { headers });

    const data = response.data as QueryResponse;

    const account = data.QueryResponse.Account?.[0];

    if (!account) {
      console.error("❌ 'Discounts given' account not found.");
      process.exit(1);
    } else {
      console.log(`✅ Found Account:`);
      console.log(`   ID:   ${account.Id}`);
      console.log(`   Name: ${account.Name}`);
      console.log(`   Type: ${account.AccountType}`);
      console.log(`   Subtype: ${account.AccountSubType}`);
      process.exit(0);
    }
  } catch (err: any) {
    console.error(`❌ Error querying account: ${err.message}`);
    process.exit(1);
  }
}

main();
