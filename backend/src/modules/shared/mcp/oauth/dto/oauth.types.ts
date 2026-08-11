/**
 * Spec-facing request shapes for the OAuth endpoints.
 *
 * These are deliberately TypeScript INTERFACES, not class-validator classes.
 * The global ValidationPipe runs `whitelist + forbidNonWhitelisted`, so a class
 * metatype would 400 any request carrying a parameter we did not declare —
 * including `resource` (RFC 8707), `code_challenge_method`, and any vendor
 * extension a future MCP host sends. An interface emits `design:paramtypes =
 * Object`, which ValidationPipe skips entirely, so the raw body/query arrives
 * untouched and we validate by hand (we need RFC-shaped errors anyway).
 *
 * Same trick as the Capgo OTA endpoint — see mobile-updates.controller.ts.
 */

export interface AuthorizeQuery {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  /** RFC 8707 resource indicator — the MCP server URL the token is bound to. */
  resource?: string;
  [key: string]: string | undefined;
}

export interface TokenRequestBody {
  grant_type?: string;
  code?: string;
  redirect_uri?: string;
  client_id?: string;
  client_secret?: string;
  code_verifier?: string;
  refresh_token?: string;
  scope?: string;
  resource?: string;
  [key: string]: string | undefined;
}

export interface RevokeRequestBody {
  token?: string;
  token_type_hint?: string;
  client_id?: string;
  [key: string]: string | undefined;
}

/** RFC 7591 §2 client metadata, as posted to the registration endpoint. */
export interface RegisterRequestBody {
  client_name?: string;
  redirect_uris?: string[];
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
  scope?: string;
  client_uri?: string;
  logo_uri?: string;
  software_id?: string;
  software_version?: string;
  [key: string]: unknown;
}

/** A client resolved from either the CIMD document or the DCR table. */
export interface ResolvedOAuthClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  client_secret_hash?: string | null;
  /** How we learned about this client — surfaced on the consent screen. */
  source: 'cimd' | 'dcr';
}

/** An authorization request parked in Redis while the user logs in + consents. */
export interface PendingAuthorization {
  request_id: string;
  client_id: string;
  client_name: string;
  client_source: 'cimd' | 'dcr';
  redirect_uri: string;
  state?: string;
  code_challenge: string;
  code_challenge_method: 'S256';
  requested_scopes: string[];
  resource: string;
  created_at: number;
}

/** A minted authorization code parked in Redis until /token redeems it. */
export interface StoredAuthorizationCode {
  client_id: string;
  user_id: string;
  redirect_uri: string;
  granted_scopes: string[];
  code_challenge: string;
  resource: string;
  client_name: string;
  client_source: 'cimd' | 'dcr';
}
