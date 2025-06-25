import axios from "axios";
import fs from "fs";
import path from "path";
import { getQboAuthHeaders, getQboBaseUrl } from "../auth";

interface PaymentMethod {
  Id: string;
  Name: string;
  Type?: string;
}

interface PaymentMethodQueryResponse {
  QueryResponse?: {
    PaymentMethod?: PaymentMethod[];
  };
}

async function main() {
  try {
    const headers = await getQboAuthHeaders();
    const baseUrl = await getQboBaseUrl();

    const response = await axios.post<PaymentMethodQueryResponse>(
      `${baseUrl}/query?query=${encodeURIComponent("SELECT * FROM PaymentMethod")}`,
      null,
      { headers }
    );

    const paymentMethods = response.data?.QueryResponse?.PaymentMethod || [];

    if (paymentMethods.length === 0) {
      console.log("⚠️ No PaymentMethods found in QBO.");
      return;
    }

    const mapping: Record<string, string> = {};

    console.log("📋 Found Payment Methods:");
    for (const method of paymentMethods) {
      console.log(`• ${method.Name} → ID ${method.Id}`);
      mapping[method.Name] = method.Id;
    }

    const outputPath = path.resolve(__dirname, "payment_method_map.json");
    fs.writeFileSync(outputPath, JSON.stringify(mapping, null, 2));
    console.log(`✅ Saved mapping to ${outputPath}`);
  } catch (err: any) {
    console.error("❌ Failed to fetch payment methods:", err.response?.data || err.message);
    process.exit(1);
  }
}

main();