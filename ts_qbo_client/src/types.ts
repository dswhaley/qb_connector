// types.ts

// Interface representing QuickBooks OAuth and API settings
export interface QuickBooksSettings {
  name: string;            // Name of the settings document
  clientId: string;        // QuickBooks API client ID
  clientSecret: string;    // QuickBooks API client secret
  accessToken?: string;    // OAuth access token (optional)
  refreshToken?: string;   // OAuth refresh token (optional)
  realmId?: string;        // QuickBooks company ID (optional)
  redirectUri: string;     // OAuth redirect URI
  last_refresh: string;    // Timestamp of last token refresh
}