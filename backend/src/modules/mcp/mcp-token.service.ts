import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { McpScope, sanitizeScopes } from './mcp-scopes';

const TOKEN_PREFIX = 'pk_';
const TOKEN_BYTES = 32;

/** Non-secret metadata safe to return in a token listing. */
export interface McpTokenSummary {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** Result of issuing a token — the raw `token` is shown to the caller once. */
export interface McpTokenIssued extends McpTokenSummary {
  token: string;
}

/** Row shape resolved by the auth guard (includes the owner + validity fields). */
export interface McpResolvedToken {
  id: string;
  user_id: string;
  scopes: string[];
  expires_at: string | null;
  revoked_at: string | null;
}

@Injectable()
export class McpTokenService {
  private readonly logger = new Logger(McpTokenService.name);

  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Mint a new PAT for `userId`. Returns the raw token exactly once; only its
   * sha256 hash is persisted. `expiresAt` is an optional ISO timestamp.
   */
  async issueToken(
    userId: string,
    name: string,
    requestedScopes: readonly string[],
    expiresAt?: string | null,
  ): Promise<McpTokenIssued> {
    const scopes: McpScope[] = sanitizeScopes(requestedScopes);
    const raw = TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('base64url');
    const tokenHash = this.hash(raw);
    const tokenPrefix = raw.slice(0, TOKEN_PREFIX.length + 8);

    const { data, error } = await this.db
      .from('mcp_personal_access_tokens')
      .insert({
        user_id: userId,
        name,
        token_hash: tokenHash,
        token_prefix: tokenPrefix,
        scopes,
        expires_at: expiresAt ?? null,
      })
      .select(
        'id, name, token_prefix, scopes, last_used_at, expires_at, revoked_at, created_at',
      )
      .single();

    if (error || !data) {
      throw new Error(`Failed to issue MCP token: ${error?.message}`);
    }

    return { ...(data as McpTokenSummary), token: raw };
  }

  /** List a user's tokens (metadata only — never the hash or raw value). */
  async listTokens(userId: string): Promise<McpTokenSummary[]> {
    const { data, error } = await this.db
      .from('mcp_personal_access_tokens')
      .select(
        'id, name, token_prefix, scopes, last_used_at, expires_at, revoked_at, created_at',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to list MCP tokens: ${error.message}`);
    return (data ?? []) as McpTokenSummary[];
  }

  /** Revoke (soft-delete) a token the caller owns. Idempotent. */
  async revokeToken(userId: string, tokenId: string): Promise<boolean> {
    const { data, error } = await this.db
      .from('mcp_personal_access_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', tokenId)
      .eq('user_id', userId)
      .is('revoked_at', null)
      .select('id');

    if (error) throw new Error(`Failed to revoke MCP token: ${error.message}`);
    return (data ?? []).length > 0;
  }

  /**
   * Resolve a presented raw token to its owner + scopes for the auth guard.
   * Returns null when the token is unknown, revoked, or expired. Bumps
   * last_used_at fire-and-forget on a successful resolution.
   */
  async resolveToken(rawToken: string): Promise<McpResolvedToken | null> {
    if (!rawToken.startsWith(TOKEN_PREFIX)) return null;
    const tokenHash = this.hash(rawToken);

    const { data, error } = await this.db
      .from('mcp_personal_access_tokens')
      .select('id, user_id, scopes, expires_at, revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (error) {
      this.logger.warn(`MCP token lookup failed: ${error.message}`);
      return null;
    }
    if (!data) return null;

    const row = data as McpResolvedToken;
    if (row.revoked_at) return null;
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
      return null;
    }

    // Fire-and-forget usage bookkeeping — never blocks or fails the request.
    void this.db
      .from('mcp_personal_access_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', row.id)
      .then(
        () => undefined,
        (e) => this.logger.debug(`last_used_at bump failed: ${e}`),
      );

    return row;
  }
}
