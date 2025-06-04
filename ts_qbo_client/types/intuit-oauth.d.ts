// types/intuit-oauth.d.ts
declare module 'intuit-oauth' {
  interface OAuthClientConfig {
    clientId: string;
    clientSecret: string;
    environment: 'sandbox' | 'production';
    redirectUri: string;
  }

  interface AuthorizeUriOptions {
    scope: string[];
    state?: string;
  }

  interface Token {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
    x_refresh_token_expires_in: number;
  }

  interface TokenResponse {
    getToken(): Token;
  }

  class OAuthClient {
    constructor(config: OAuthClientConfig);
    authorizeUri(options: AuthorizeUriOptions): string;
    createToken(uri: string): Promise<TokenResponse>;
    refreshUsingToken(refreshToken: string): Promise<TokenResponse>;
  }

  namespace OAuthClient {
    const scopes: {
      Accounting: string;
      OpenId: string;
    };
  }

  export = OAuthClient;
}
