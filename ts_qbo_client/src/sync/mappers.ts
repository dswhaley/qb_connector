// mappers.ts

// Import QuickBooksSettings type definition
import { QuickBooksSettings } from '../types';

/**
 * Maps a raw Frappe settings object to a QuickBooksSettings object.
 * @param raw - Raw settings object from Frappe
 * @returns QuickBooksSettings object
 */
export function fromFrappe(raw: any): QuickBooksSettings {
  // Map each field from Frappe to QuickBooksSettings
  return {
    name: raw.name, // Frappe document name
    clientId: raw.clientid, // QBO client ID
    clientSecret: raw.clientsecret, // QBO client secret
    accessToken: raw.accesstoken, // QBO access token
    refreshToken: raw.refreshtoken, // QBO refresh token
    realmId: raw.realmid, // QBO company realm ID
    redirectUri: raw.redirecturi, // OAuth2 redirect URI
    last_refresh: raw.last_refresh // Last token refresh timestamp
  };
}

/**
 * Maps a QuickBooksSettings object to a Frappe-compatible settings object.
 * @param settings - QuickBooksSettings object
 * @returns Object formatted for Frappe
 */
export function toFrappe(settings: QuickBooksSettings): any {
  // Map each field from QuickBooksSettings to Frappe format
  return {
    name: settings.name, // Frappe document name
    clientid: settings.clientId, // QBO client ID
    clientsecret: settings.clientSecret, // QBO client secret
    accesstoken: settings.accessToken, // QBO access token
    refreshtoken: settings.refreshToken, // QBO refresh token
    realmid: settings.realmId, // QBO company realm ID
    redirecturi: settings.redirectUri, // OAuth2 redirect URI
    last_refresh: settings.last_refresh // Last token refresh timestamp
  };
}
