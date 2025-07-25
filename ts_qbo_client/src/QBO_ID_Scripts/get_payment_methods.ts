import axios from "axios";
import fs from "fs";
import path from "path";
// Import helper functions for QBO authentication and base URL
import { getQboAuthHeaders, getQboBaseUrl } from "../auth";

/**
 * Interface representing a QBO PaymentMethod object
 */
interface PaymentMethod {
  Id: string; // PaymentMethod ID
  Name: string; // PaymentMethod name
  Type?: string; // Optional type
}

/**
 * Interface for QBO PaymentMethod query response
 */
interface PaymentMethodQueryResponse {
  QueryResponse?: {
    PaymentMethod?: PaymentMethod[]; // Array of PaymentMethod objects
  };
}

/**
 * Main function to fetch and save all QBO PaymentMethods
 */
async function main() {
  try {
    // Get QBO API request headers
    const headers = await getQboAuthHeaders();
    // Get QBO API base URL
    const baseUrl = await getQboBaseUrl();

    // Send POST request to QBO API to fetch all PaymentMethods
    const response = await axios.post<PaymentMethodQueryResponse>(
      `${baseUrl}/query?query=${encodeURIComponent("SELECT * FROM PaymentMethod")}`,
      null,
      { headers }
    );

    // Extract PaymentMethods from response
    const paymentMethods = response.data?.QueryResponse?.PaymentMethod || [];

    // If no PaymentMethods found, log warning and exit
    if (paymentMethods.length === 0) {
      console.log("⚠️ No PaymentMethods found in QBO.");
      return;
    }

    // Build mapping of PaymentMethod name to ID
    const mapping: Record<string, string> = {};

    // Print all found PaymentMethods and build mapping
    console.log("📋 Found Payment Methods:");
    for (const method of paymentMethods) {
      console.log(`• ${method.Name} → ID ${method.Id}`); // Print name and ID
      mapping[method.Name] = method.Id; // Add to mapping
    }

    // Save mapping to JSON file in script directory
    const outputPath = path.resolve(__dirname, "payment_method_map.json");
    fs.writeFileSync(outputPath, JSON.stringify(mapping, null, 2));
    console.log(`✅ Saved mapping to ${outputPath}`);
  } catch (err: any) {
    // Log error and exit with failure code
    console.error("❌ Failed to fetch payment methods:", err.response?.data || err.message);
    process.exit(1);
  }
}

// Run main function
main();