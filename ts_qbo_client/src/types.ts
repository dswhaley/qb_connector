//types.ts
export interface QuickBooksSettings {
  name: string;
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  realmId?: string;
  redirectUri: string;
}