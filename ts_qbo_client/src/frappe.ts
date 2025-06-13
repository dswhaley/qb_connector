//frappe.ts
// Import libraries
import axios from 'axios';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';


// Load environment variables from .env
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../.env') }); // ✅ Load env vars


const baseUrl = process.env.FRAPPE_SITE_URL || 'http://localhost:8008';
const token = process.env.FRAPPE_API_TOKEN || '';
const ipv4Agent = new http.Agent({ family: 4 });

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
   */
  async getDoc<T>(doctype: string, name?: string): Promise<T> {

    if (!name) {
      const records = await frappe.getAll<{ name: string }>(doctype);
      if (!records.length) throw new Error(`No records found for ${doctype}`);
      name = records[0].name;
    }

    const url = `${baseUrl}/api/resource/${doctype}/${name}`;
    const response = await axios.get(url, axiosConfig());

    return (response.data as { data: T }).data;
  },

  /**
   * Update a document in ERPNext
   */
  async updateDoc(doctype: string, doc: any): Promise<void> {
    const url = `${baseUrl}/api/resource/${doctype}/${doc.name}`;
    const response = await axios.put(url, doc, axiosConfig());
  },

  /**
   * Get all documents for a given DocType
   */
  async getAll<T = any>(doctype: string): Promise<T[]> {
    const url = `${baseUrl}/api/resource/${doctype}`;
    const response = await axios.get(url, axiosConfig());
    return (response.data as { data: T[] }).data;
  },
  async getAllFiltered<T = any>(
    doctype: string,
    options?: { filters?: Record<string, any>; fields?: string[] }
  ): Promise<T[]> {
    const url = new URL(`${baseUrl}/api/resource/${doctype}`);

    if (options?.filters) {
      url.searchParams.set('filters', JSON.stringify(options.filters));
    }

    if (options?.fields) {
      url.searchParams.set('fields', JSON.stringify(options.fields));
    }

    const response = await axios.get(url.toString(), axiosConfig());
    return (response.data as { data: T[] }).data;
}, 
createDoc: async <T = any>(doctype: string, doc: Partial<T>): Promise<T> => {
  const url = `${baseUrl}/api/resource/${doctype}`;
  const response = await axios.post(url, doc, axiosConfig());
  return (response.data as { data: T }).data;
}
};
