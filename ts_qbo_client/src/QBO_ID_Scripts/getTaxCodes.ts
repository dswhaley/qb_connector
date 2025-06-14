import axios from "axios";
import { getQboAuthHeaders, getQboBaseUrl } from "../auth";

interface TaxCode {
  Id: string;
  Name: string;
  Description?: string;
  Taxable?: boolean;
}

interface TaxCodeQueryResponse {
  QueryResponse?: {
    TaxCode?: TaxCode[];
  };
}

async function main() {
  try {
    const headers = await getQboAuthHeaders();
    const baseUrl = await getQboBaseUrl();

    const response = await axios.get<TaxCodeQueryResponse>(`${baseUrl}/query`, {
      headers,
      params: {
        query: "SELECT * FROM TaxCode",
      },
    });

    const taxCodes = response.data?.QueryResponse?.TaxCode || [];

    if (taxCodes.length === 0) {
      console.log("⚠️ No TaxCodes found in QBO.");
      return;
    }

    console.log("📋 Available Tax Codes:");
    for (const code of taxCodes) {
      console.log(`🆔 ID: ${code.Id}`);
      console.log(`🏷️  Name: ${code.Name}`);
      console.log(`📄 Description: ${code.Description || "N/A"}`);
      console.log(`🧾 Taxable: ${code.Taxable}`);
      console.log("—".repeat(30));
    }
  } catch (err: any) {
    console.error("❌ Failed to fetch tax codes:", err.response?.data || err.message);
    process.exit(1);
  }
}

main();
