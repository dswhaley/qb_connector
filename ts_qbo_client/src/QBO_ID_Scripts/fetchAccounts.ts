import axios from "axios";
import fs from "fs";
import path from "path";
// Import helper functions for QBO authentication and base URL
import { getQboAuthHeaders, getQboBaseUrl } from "../auth"; // adjust path if needed

/**
 * Interface representing a QBO Account object
 */
interface QboAccount {
  Id: string; // Account ID
  Name: string; // Account name
  AccountType?: string; // Optional account type
  AccountSubType?: string; // Optional account subtype
}

/**
 * Interface for QBO Account query response
 */
interface AccountQueryResponse {
  QueryResponse?: {
    Account?: QboAccount[]; // Array of QBO Account objects
  };
}

/**
 * Main function to fetch and save all QBO Accounts
 */
async function main() {
  try {
    // Get QBO API request headers
    const headers = await getQboAuthHeaders();
    // Get QBO API base URL
    const baseUrl = await getQboBaseUrl();

    // Build SQL-like query to fetch all accounts
    const query = "SELECT * FROM Account";
    // Send POST request to QBO API to fetch all accounts
    const response = await axios.post<AccountQueryResponse>(
      `${baseUrl}/query?query=${encodeURIComponent(query)}`,
      null,
      { headers }
    );

    // Extract accounts from response
    const accounts = response.data?.QueryResponse?.Account || [];

    // If no accounts found, log warning and exit
    if (accounts.length === 0) {
      console.log("⚠️ No accounts found in QBO.");
      return;
    }

    // Print all QBO accounts and build mapping
    console.log("📋 QBO Accounts:");
    const mapping: Record<string, string> = {};

    for (const acct of accounts) {
      console.log(`• ${acct.Name} → ID ${acct.Id}`); // Print account name and ID
      mapping[acct.Name] = acct.Id; // Add to mapping
    }

    // Save mapping to JSON file in script directory
    const outputPath = path.resolve(__dirname, "account_id_map.json");
    fs.writeFileSync(outputPath, JSON.stringify(mapping, null, 2));
    console.log(`✅ Saved account ID map to ${outputPath}`);
  } catch (err: any) {
    // Log error and exit with failure code
    console.error("❌ Failed to fetch QBO accounts:", err.response?.data || err.message);
    process.exit(1);
  }
}

// Run main function
main();
