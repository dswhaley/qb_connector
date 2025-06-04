// Import libraries
import axios from 'axios';
import http from 'http';
import dotenv from 'dotenv';

// Load environment variables from .env
dotenv.config();

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
  }
};
