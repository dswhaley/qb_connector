// mappers.ts
import { QuickBooksSettings } from '../types';

export function fromFrappe(raw: any): QuickBooksSettings {

  return {
    name: raw.name,
    clientId: raw.clientid,
    clientSecret: raw.clientsecret,
    accessToken: raw.accesstoken,
    refreshToken: raw.refreshtoken,
    realmId: raw.realmid,
    redirectUri: raw.redirecturi,
    last_refresh: raw.last_refresh
  };
}

export function toFrappe(settings: QuickBooksSettings): any {
  return {
    name: settings.name,
    clientid: settings.clientId,
    clientsecret: settings.clientSecret,
    accesstoken: settings.accessToken,
    refreshtoken: settings.refreshToken,
    realmid: settings.realmId,
    redirecturi: settings.redirectUri,
    last_refresh: settings.last_refresh
  };
}
