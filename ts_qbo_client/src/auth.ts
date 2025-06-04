import IntuitOAuth from 'intuit-oauth';
import { frappe } from './frappe';
import { QuickBooksSettings } from './types';
import { fromFrappe, toFrappe } from './mappers';
import { v4 as uuidv4 } from 'uuid';

export class QuickBooksAuth {
  private authClient: IntuitOAuth;

  constructor(settings: QuickBooksSettings) {
    this.authClient = new IntuitOAuth({
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
      environment: 'sandbox',
      redirectUri: settings.redirectUri
    });
  }

  /**
   * Builds the QuickBooks OAuth2 login URL.
   */
  async initiateAuth(): Promise<string> {
    return this.authClient.authorizeUri({
      scope: ['com.intuit.quickbooks.accounting'],
      state: uuidv4(),
    });
  }

  /**
   * Handles the OAuth2 callback from QuickBooks.
   */
  async handleCallback(code: string, realmId: string, state?: string): Promise<void> {
    try {
      const raw = await frappe.getDoc('QuickBooks Settings');
      const settings = fromFrappe(raw);

      this.authClient = new IntuitOAuth({
        clientId: settings.clientId,
        clientSecret: settings.clientSecret,
        environment: 'sandbox',
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




      
      await frappe.updateDoc('QuickBooks Settings', toFrappe(settings));
   
    } catch (error: any) {
      console.error('❌ Failed to handle QBO callback:', error);
      throw new Error(`OAuth2 callback failed: ${error.message}`);
    }
  }

  /**
   * Refreshes the QuickBooks access token.
   */
  async refreshToken(): Promise<void> {
    const ts = new Date().toISOString();
    const startGetDoc = Date.now();
    const raw = await frappe.getDoc<QuickBooksSettings>('QuickBooks Settings');
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

      const startUpdate = Date.now();
      await frappe.updateDoc('QuickBooks Settings', toFrappe(settings));
    } catch (error: any) {
      console.error(`[${ts}] Token refresh failed:`, error.message, error.stack, error.response?.data);
      throw new Error(`Refresh token failed: ${error.message}`);
    }
  }
}
