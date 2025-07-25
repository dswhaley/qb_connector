// src/auth.ts

// This file handles QuickBooks Online OAuth2 authentication and token management for ERPNext integration.

// Imports for Intuit OAuth, Frappe API, type mapping, UUID, environment, and date handling
import IntuitOAuth from 'intuit-oauth';
import { frappe } from './frappe';
import { QuickBooksSettings } from './types';
import { fromFrappe, toFrappe } from './sync/mappers'; 
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import dayjs from 'dayjs';

// Load environment variables from .env file
dotenv.config();

// Expected .env entries:
// QBO_ENV=sandbox | production

/**
 * Class for handling QuickBooks OAuth2 authentication and token management.
 */
export class QuickBooksAuth {
  /**
   * Intuit OAuth client instance
   */
  private authClient: IntuitOAuth;

  /**
   * Constructs a QuickBooksAuth instance with given settings.
   * @param settings - QuickBooksSettings object
   */
  constructor(settings: QuickBooksSettings) {
    const environment = process.env.QBO_ENV || 'sandbox';
    this.authClient = new IntuitOAuth({
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
      environment: environment as 'sandbox' | 'production',
      redirectUri: settings.redirectUri
    });
  }

  /**
   * Builds the QuickBooks OAuth2 login URL.
   * @returns The OAuth2 authorization URL for QuickBooks login.
   */
  async initiateAuth(): Promise<string> {
    const url = this.authClient.authorizeUri({
      scope: ['com.intuit.quickbooks.accounting'],
      state: uuidv4(),
    });
    return url;
  }

  /**
   * Handles the OAuth2 callback from QuickBooks.
   * Exchanges code for tokens and updates settings in Frappe.
   * @param code - OAuth2 code from QuickBooks
   * @param realmId - QuickBooks company ID
   * @param state - Optional state parameter
   */
  async handleCallback(code: string, realmId: string, state?: string): Promise<void> {
    try {
      //const raw = await frappe.getDoc('QuickBooks Settings');
      const raw = await frappe.getDoc('QuickBooks Settings', 'QuickBooks Settings');


      const settings = fromFrappe(raw);

      this.authClient = new IntuitOAuth({
        clientId: settings.clientId,
        clientSecret: settings.clientSecret,
        environment: (process.env.QBO_ENV || 'sandbox') as 'sandbox' | 'production', // ✅ fixed here
        redirectUri: settings.redirectUri

      });

      if (!code || !realmId) {
        throw new Error('Missing code or realmId in callback');
      }

      const callbackUrl = `${settings.redirectUri}?code=${encodeURIComponent(code)}&realmId=${encodeURIComponent(realmId)}${state ? `&state=${encodeURIComponent(state)}` : ''}`;
      console.log('Callback URL:', callbackUrl);

      const tokenResponse = await this.authClient.createToken(callbackUrl);
      const token = tokenResponse.getToken();

      if (!token.access_token || !token.refresh_token) {
        throw new Error('Invalid token response: access_token or refresh_token missing');
      }

      settings.accessToken = token.access_token;
      settings.refreshToken = token.refresh_token;
      settings.realmId = realmId;
      settings.last_refresh = dayjs().format('YYYY-MM-DD HH:mm:ss');

      await frappe.updateDoc('QuickBooks Settings', toFrappe(settings));
   
    } catch (error: any) {
      console.error('❌ Failed to handle QBO callback:', error);
      throw new Error(`OAuth2 callback failed: ${error.message}`);
    }
  }

  /**
   * Refreshes the QuickBooks access token using the stored refresh token.
   */
  async refreshToken(): Promise<void> {
    const ts = new Date().toISOString();
    const startGetDoc = Date.now();
    const raw = await frappe.getDoc('QuickBooks Settings', 'QuickBooks Settings');

    console.log(`[${ts}] getDoc took ${Date.now() - startGetDoc}ms`);
    const settings = fromFrappe(raw);

    if (!settings.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const startRefresh = Date.now();
      const tokenResponse = await this.authClient.refreshUsingToken(settings.refreshToken);
      const token = tokenResponse.getToken();

      if (!token.access_token || !token.refresh_token) {
        throw new Error('Invalid refresh token response: access_token or refresh_token missing');
      }

      settings.accessToken = token.access_token;
      settings.refreshToken = token.refresh_token;
      settings.last_refresh = dayjs().format('YYYY-MM-DD HH:mm:ss');

      const startUpdate = Date.now();
      await frappe.updateDoc('QuickBooks Settings', toFrappe(settings));
    } catch (error: any) {
      console.error(`[${ts}] Token refresh failed:`, error.message, error.stack, error.response?.data);
      throw new Error(`Refresh token failed: ${error.message}`);
    }
  }
}

/**
 * Returns QBO request headers with auth token for API calls.
 * @returns Object containing Authorization, Accept, and Content-Type headers.
 */
export async function getQboAuthHeaders(): Promise<{
  Authorization: string;
  Accept: string;
  'Content-Type': string;
}> {
  const rawSettings = await frappe.getDoc('QuickBooks Settings', 'QuickBooks Settings');

  const settings: QuickBooksSettings = fromFrappe(rawSettings);

  if (!settings.accessToken) {
    throw new Error('❌ No QBO access token found in QuickBooks Settings');
  }

  return {
    Authorization: `Bearer ${settings.accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

/**
 * Returns the QuickBooks realmId from settings.
 * @returns The QuickBooks company realmId string.
 */
export async function getRealmId(): Promise<string>{
  const rawSettings = await frappe.getDoc('QuickBooks Settings', 'QuickBooks Settings');

  const settings: QuickBooksSettings = fromFrappe(rawSettings);

  if (!settings.realmId) {
    throw new Error('❌ No QBO access token found in QuickBooks Settings');
  }
  
  return settings.realmId;
}
/**
 * Returns correct QBO API base URL based on environment and realmId.
 * @returns The full QBO API base URL for the current environment and company.
 */
export async function getQboBaseUrl(): Promise<string> {
  const rawSettings = await frappe.getDoc('QuickBooks Settings', 'QuickBooks Settings');
  const settings: QuickBooksSettings = fromFrappe(rawSettings);

  if (!settings.realmId) {
    throw new Error('❌ Missing realmId in QuickBooks Settings');
  }

  const env = process.env.QBO_ENV?.toLowerCase();
  const base = env === 'production'
    ? 'https://quickbooks.api.intuit.com/v3/company'
    : 'https://sandbox-quickbooks.api.intuit.com/v3/company';

  return `${base}/${settings.realmId}`;
}
