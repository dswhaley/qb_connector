// src/findDiscountAccount.ts

// Import helper functions for QBO authentication and base URL
import { getQboBaseUrl, getQboAuthHeaders } from "../auth";
import axios from "axios";

/**
 * Interface representing a QBO Account object
 */
interface Account {
  Id: string; // Account ID
  Name: string; // Account name
  AccountType: string; // Account type
  AccountSubType: string; // Account subtype
}

/**
 * Interface for QBO Account query response
 */
interface QueryResponse {
  QueryResponse: {
    Account?: Account[]; // Array of Account objects
  };
}

/**
 * Main function to find the 'Discounts given' account in QBO
 */
async function main() {
  try {
    // Get QBO API base URL
    const baseUrl = await getQboBaseUrl();
    // Get QBO API request headers
    const headers = await getQboAuthHeaders();

    // Build SQL-like query to find account by name
    const query = `SELECT * FROM Account WHERE Name = 'Discounts given'`;
    // Build full QBO API URL for query
    const url = `${baseUrl}/query?query=${encodeURIComponent(query)}`;

    // Send GET request to QBO API
    const response = await axios.get(url, { headers });

    // Cast response data to QueryResponse type
    const data = response.data as QueryResponse;

    // Get the first matching account from response
    const account = data.QueryResponse.Account?.[0];

    // If account not found, log error and exit
    if (!account) {
      console.error("❌ 'Discounts given' account not found.");
      process.exit(1);
    } else {
      // Print account details
      console.log(`✅ Found Account:`);
      console.log(`   ID:   ${account.Id}`);
      console.log(`   Name: ${account.Name}`);
      console.log(`   Type: ${account.AccountType}`);
      console.log(`   Subtype: ${account.AccountSubType}`);
      process.exit(0);
    }
  } catch (err: any) {
    // Log error and exit with failure code
    console.error(`❌ Error querying account: ${err.message}`);
    process.exit(1);
  }
}

// Run main function
main();
