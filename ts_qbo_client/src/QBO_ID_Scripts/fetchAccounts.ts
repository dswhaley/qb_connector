import axios from "axios";
import fs from "fs";
import path from "path";
import { getQboAuthHeaders, getQboBaseUrl } from "../auth"; // adjust path if needed

interface QboAccount {
  Id: string;
  Name: string;
  AccountType?: string;
  AccountSubType?: string;
}

interface AccountQueryResponse {
  QueryResponse?: {
    Account?: QboAccount[];
  };
}

async function main() {
  try {
    const headers = await getQboAuthHeaders();
    const baseUrl = await getQboBaseUrl();

    const query = "SELECT * FROM Account";
    const response = await axios.post<AccountQueryResponse>(
      `${baseUrl}/query?query=${encodeURIComponent(query)}`,
      null,
      { headers }
    );

    const accounts = response.data?.QueryResponse?.Account || [];

    if (accounts.length === 0) {
      console.log("⚠️ No accounts found in QBO.");
      return;
    }

    console.log("📋 QBO Accounts:");
    const mapping: Record<string, string> = {};

    for (const acct of accounts) {
      console.log(`• ${acct.Name} → ID ${acct.Id}`);
      mapping[acct.Name] = acct.Id;
    }

    const outputPath = path.resolve(__dirname, "account_id_map.json");
    fs.writeFileSync(outputPath, JSON.stringify(mapping, null, 2));
    console.log(`✅ Saved account ID map to ${outputPath}`);
  } catch (err: any) {
    console.error("❌ Failed to fetch QBO accounts:", err.response?.data || err.message);
    process.exit(1);
  }
}

main();
