import axios from "axios";
// Import helper functions for QBO authentication and base URL
import { getQboAuthHeaders, getQboBaseUrl } from "../auth";

/**
 * Interface representing a QBO TaxCode object
 */
interface TaxCode {
  Id: string; // TaxCode ID
  Name: string; // TaxCode name
  Description?: string; // Optional description
  Taxable?: boolean; // Indicates if taxable
}

/**
 * Interface for QBO TaxCode query response
 */
interface TaxCodeQueryResponse {
  QueryResponse?: {
    TaxCode?: TaxCode[]; // Array of TaxCode objects
  };
}

/**
 * Main function to fetch and display all QBO TaxCodes
 */
async function main() {
  try {
    // Get QBO API request headers
    const headers = await getQboAuthHeaders();
    // Get QBO API base URL
    const baseUrl = await getQboBaseUrl();

    // Send GET request to QBO API to fetch all TaxCodes
    const response = await axios.get<TaxCodeQueryResponse>(`${baseUrl}/query`, {
      headers,
      params: {
        query: "SELECT * FROM TaxCode", // SQL-like query for QBO
      },
    });

    // Extract TaxCodes from response
    const taxCodes = response.data?.QueryResponse?.TaxCode || [];

    // If no TaxCodes found, log warning and exit
    if (taxCodes.length === 0) {
      console.log("⚠️ No TaxCodes found in QBO.");
      return;
    }

    // Print all available TaxCodes
    console.log("📋 Available Tax Codes:");
    for (const code of taxCodes) {
      console.log(`🆔 ID: ${code.Id}`); // Print TaxCode ID
      console.log(`🏷️  Name: ${code.Name}`); // Print TaxCode name
      console.log(`📄 Description: ${code.Description || "N/A"}`); // Print description
      console.log(`🧾 Taxable: ${code.Taxable}`); // Print taxable status
      console.log("—".repeat(30)); // Separator
    }
  } catch (err: any) {
    // Log error and exit with failure code
    console.error("❌ Failed to fetch tax codes:", err.response?.data || err.message);
    process.exit(1);
  }
}

// Run main function
main();
