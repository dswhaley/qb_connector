// frappe.ts
// Import libraries for HTTP requests, environment variables, and path handling
import axios from 'axios';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file (supports local and parent directory)
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../.env') }); // ✅ Load env vars

// Base URL and API token for Frappe site
const baseUrl = process.env.FRAPPE_SITE_URL || 'http://localhost:8008';
const token = process.env.FRAPPE_API_TOKEN || '';
const ipv4Agent = new http.Agent({ family: 4 }); // Force IPv4 for requests

// Helper to build axios config with auth and agent
function axiosConfig() {
  return {
    headers: {
      Authorization: `token ${token}`
    },
    httpAgent: ipv4Agent
  };
}

/**
 * Frappe REST API client wrapper
 */
export const frappe = {
  /**
   * Fetch a document from ERPNext.
   * If no name is provided, and multiple documents exist, returns the first.
   * Handles singleton documents if no name is given.
   */
  async getDoc<T>(doctype: string, name?: string): Promise<T> {
    const url = name
      ? `${baseUrl}/api/resource/${doctype}/${name}`
      : `${baseUrl}/api/resource/${doctype}`;  // Handles singleton

    const response = await axios.get(url, axiosConfig());
    return (response.data as { data: T }).data;
  },

  /**
   * Update a document in ERPNext.
   * If doc.name is present, updates that document; otherwise, updates singleton.
   */
  async updateDoc(doctype: string, doc: any): Promise<void> {
    const url = doc.name
      ? `${baseUrl}/api/resource/${doctype}/${doc.name}`
      : `${baseUrl}/api/resource/${doctype}`; // Handles singleton

    await axios.put(url, doc, axiosConfig());
  },

  /**
   * Get all documents for a given DocType (up to 1000).
   */
  async getAll<T = any>(doctype: string): Promise<T[]> {
    const url = new URL(`${baseUrl}/api/resource/${doctype}`);
    url.searchParams.set('limit_page_length', '1000');  // Use max safe limit

    const response = await axios.get(url.toString(), axiosConfig());
    return (response.data as { data: T[] }).data;
  },

  /**
   * Get filtered documents for a given DocType, with optional filters, fields, and limit.
   */
  async getAllFiltered<T = any>(
    doctype: string,
    options?: { filters?: Record<string, any>; fields?: string[]; limit?: number }
  ): Promise<T[]> {
    const url = new URL(`${baseUrl}/api/resource/${doctype}`);

    if (options?.filters) {
      url.searchParams.set("filters", JSON.stringify(options.filters));
    }

    if (options?.fields) {
      url.searchParams.set("fields", JSON.stringify(options.fields));
    }

    if (options?.limit) {
      url.searchParams.set("limit_page_length", options.limit.toString());
    }

    const response = await axios.get(url.toString(), axiosConfig());
    return (response.data as { data: T[] }).data;
  },

  /**
   * Create a new document in ERPNext for the given DocType.
   */
  createDoc: async <T = any>(doctype: string, doc: Partial<T>): Promise<T> => {
    const url = `${baseUrl}/api/resource/${doctype}`;
    const response = await axios.post(url, doc, axiosConfig());
    return (response.data as { data: T }).data;
  },

  /**
   * Submit a document in ERPNext (changes status to submitted).
   * Re-fetches the latest document before submitting to get a fresh timestamp.
   */
  submitDoc: async (doctype: string, name: string): Promise<void> => {
    // Re-fetch latest document before submitting to get a fresh timestamp
    const latestDoc = await frappe.getDoc(doctype, name);

    const url = `${baseUrl}/api/method/frappe.client.submit`;
    await axios.post(
      url,
      { doc: latestDoc },
      axiosConfig()
    );
  }
};
