import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { OAuthConfigService } from './oauth-config.service';
import { OAuthJwtService } from './oauth-jwt.service';
import { OAuthClientService, redirectUriMatches } from './oauth-client.service';
import { OAuthError } from './oauth-error';
import {
  OAuthRedirectError,
  OAuthService,
  parseScopes,
  verifyPkce,
} from './oauth.service';
import type { ResolvedOAuthClient } from './dto/oauth.types';
import { McpCapabilitiesService } from '../mcp-capabilities.service';

const ISSUER = 'https://api.example.test';
const RESOURCE = `${ISSUER}/mcp`;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

const CLIENT: ResolvedOAuthClient = {
  client_id: 'https://claude.ai/oauth/claude-code-client-metadata',
  client_name: 'Claude',
  redirect_uris: [REDIRECT],
  token_endpoint_auth_method: 'none',
  source: 'cimd',
};

/** A tiny in-memory stand-in with the two Upstash calls the service makes. */
function fakeRedis() {
  const store = new Map<string, unknown>();
  return {
    store,
    set: jest.fn(async (k: string, v: unknown) => {
      store.set(k, v);
      return 'OK';
    }),
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    del: jest.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
    // The real client does this atomically — single-use redemption depends on it.
    getdel: jest.fn(async (k: string) => {
      const v = store.get(k) ?? null;
      store.delete(k);
      return v;
    }),
  };
}

function makeService(
  overrides: { clients?: Partial<OAuthClientService> } = {},
) {
  const values: Record<string, string> = {
    MCP_ENABLED: 'true',
    MCP_OAUTH_ENABLED: 'true',
    MCP_OAUTH_JWT_SECRET: 'a-test-signing-secret-of-sufficient-length',
    MCP_OAUTH_ISSUER: ISSUER,
    MCP_OAUTH_RESOURCE: RESOURCE,
    CLIENT_URL: 'https://app.example.test',
  };
  const configService = {
    get: (k: string) => values[k],
  } as unknown as ConfigService;
  const config = new OAuthConfigService(
    configService,
    new McpCapabilitiesService(configService),
  );

  const redis = fakeRedis();
  const clients = {
    resolve: jest.fn(async () => CLIENT),
    assertClientAuthenticated: jest.fn(),
    ...overrides.clients,
  } as unknown as OAuthClientService;

  const db = { from: jest.fn() } as any;
  const service = new OAuthService(
    db,
    redis as any,
    config,
    clients,
    new OAuthJwtService(config),
  );
  return { service, redis, clients, db, config };
}

/** Stub the grant insert that issueTokens performs on a successful exchange. */
function stubGrantInsert(db: any) {
  const insert = jest.fn(async () => ({ error: null }));
  db.from.mockReturnValue({ insert });
  return insert;
}

const VERIFIER = randomBytes(40).toString('base64url');
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

function authorizeQuery(extra: Record<string, string> = {}) {
  return {
    response_type: 'code',
    client_id: CLIENT.client_id,
    redirect_uri: REDIRECT,
    scope: 'roadmaps:read tasks:write offline_access',
    state: 'st-1',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    resource: RESOURCE,
    ...extra,
  };
}

describe('parseScopes', () => {
  it('keeps only scopes this server understands and de-dupes', () => {
    expect(
      parseScopes('roadmaps:read bogus:scope roadmaps:read chat:read'),
    ).toEqual(['roadmaps:read', 'chat:read']);
  });

  it('returns nothing for an empty or entirely-unknown request', () => {
    expect(parseScopes('')).toEqual([]);
    expect(parseScopes('made:up')).toEqual([]);
  });
});

describe('verifyPkce', () => {
  it('accepts the matching verifier', () => {
    expect(() => verifyPkce(VERIFIER, CHALLENGE)).not.toThrow();
  });

  it('rejects a wrong verifier', () => {
    const other = randomBytes(40).toString('base64url');
    expect(() => verifyPkce(other, CHALLENGE)).toThrow(OAuthError);
  });

  it('rejects a verifier outside the RFC 7636 length bounds', () => {
    expect(() => verifyPkce('too-short', CHALLENGE)).toThrow(OAuthError);
  });
});

describe('redirectUriMatches', () => {
  it('requires an exact match for non-loopback URIs', () => {
    expect(redirectUriMatches([REDIRECT], REDIRECT)).toBe(true);
    expect(
      redirectUriMatches(
        [REDIRECT],
        'https://evil.example/api/mcp/auth_callback',
      ),
    ).toBe(false);
  });

  it('ignores the port on loopback redirects (RFC 8252 §7.3)', () => {
    // Claude Code declares a port-less loopback URI and binds an ephemeral port.
    const registered = [
      'http://localhost/callback',
      'http://127.0.0.1/callback',
    ];
    expect(
      redirectUriMatches(registered, 'http://localhost:3118/callback'),
    ).toBe(true);
    expect(
      redirectUriMatches(registered, 'http://127.0.0.1:51234/callback'),
    ).toBe(true);
  });

  it('does not let the loopback rule widen the path or host', () => {
    const registered = ['http://localhost/callback'];
    expect(redirectUriMatches(registered, 'http://localhost:3118/other')).toBe(
      false,
    );
    expect(redirectUriMatches(registered, 'http://evil.example/callback')).toBe(
      false,
    );
  });
});

describe('OAuthService.beginAuthorization', () => {
  it('parks the request and points the browser at the consent screen', async () => {
    const { service, redis } = makeService();
    const url = await service.beginAuthorization(authorizeQuery());

    expect(url).toMatch('https://app.example.test/oauth/authorize?request_id=');
    expect(redis.set).toHaveBeenCalledTimes(1);
    const [key] = redis.set.mock.calls[0];
    expect(key).toMatch(/^mcp:oauth:pending:/);
  });

  it('refuses an unregistered redirect_uri without bouncing the user to it', async () => {
    const { service } = makeService();
    await expect(
      service.beginAuthorization(
        authorizeQuery({ redirect_uri: 'https://evil.example/steal' }),
      ),
    ).rejects.toBeInstanceOf(OAuthError);
  });

  it('requires S256 PKCE, reporting back to the validated redirect_uri', async () => {
    const { service } = makeService();
    await expect(
      service.beginAuthorization(
        authorizeQuery({ code_challenge_method: 'plain' }),
      ),
    ).rejects.toBeInstanceOf(OAuthRedirectError);
  });

  it('rejects a resource indicator naming another server', async () => {
    const { service } = makeService();
    await expect(
      service.beginAuthorization(
        authorizeQuery({ resource: 'https://elsewhere.example/mcp' }),
      ),
    ).rejects.toBeInstanceOf(OAuthRedirectError);
  });
});

describe('OAuthService consent → token', () => {
  async function approvedCode(granted = ['roadmaps:read', 'offline_access']) {
    const ctx = makeService();
    const consentUrl = await ctx.service.beginAuthorization(authorizeQuery());
    const requestId = new URL(consentUrl).searchParams.get('request_id')!;
    const redirectTo = await ctx.service.approve(requestId, 'user-1', granted);
    const code = new URL(redirectTo).searchParams.get('code')!;
    return { ...ctx, code, redirectTo, requestId };
  }

  it('returns the code and preserves state on the client redirect', async () => {
    const { redirectTo } = await approvedCode();
    const url = new URL(redirectTo);
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe('st-1');
    expect(url.searchParams.get('code')).toMatch(/^mcpc_/);
  });

  it('can only narrow the requested scopes, never widen them', async () => {
    const ctx = makeService();
    const consentUrl = await ctx.service.beginAuthorization(
      authorizeQuery({ scope: 'roadmaps:read' }),
    );
    const requestId = new URL(consentUrl).searchParams.get('request_id')!;

    // The user "grants" a write scope the client never asked for — dropped.
    const redirectTo = await ctx.service.approve(requestId, 'user-1', [
      'roadmaps:read',
      'roadmaps:write',
    ]);
    const code = new URL(redirectTo).searchParams.get('code')!;
    const stored: any = ctx.redis.store.get(
      `mcp:oauth:code:${createHash('sha256').update(code).digest('hex')}`,
    );
    expect(stored.granted_scopes).toEqual(['roadmaps:read']);
  });

  it('exchanges a code for an audience-bound access token + refresh token', async () => {
    const { service, db, code, config } = await approvedCode();
    stubGrantInsert(db);

    const result = await service.token({
      grant_type: 'authorization_code',
      code,
      client_id: CLIENT.client_id,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
    });

    expect(result.token_type).toBe('Bearer');
    expect(result.refresh_token).toMatch(/^mcpr_/);
    expect(result.scope).toBe('roadmaps:read offline_access');

    const verified = new OAuthJwtService(config).verifyAccessToken(
      String(result.access_token),
    );
    expect(verified?.userId).toBe('user-1');
    // offline_access is an OAuth signal, not a tool grant — it must not reach
    // the MCP scope set.
    expect(verified?.scopes).toEqual(['roadmaps:read']);
  });

  it('refuses to redeem the same code twice', async () => {
    const { service, db, code } = await approvedCode();
    stubGrantInsert(db);

    const body = {
      grant_type: 'authorization_code',
      code,
      client_id: CLIENT.client_id,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
    };
    await service.token(body);
    await expect(service.token(body)).rejects.toMatchObject({
      code: 'invalid_grant',
    });
  });

  it('refuses a code exchange with the wrong PKCE verifier', async () => {
    const { service, db, code } = await approvedCode();
    stubGrantInsert(db);

    await expect(
      service.token({
        grant_type: 'authorization_code',
        code,
        client_id: CLIENT.client_id,
        redirect_uri: REDIRECT,
        code_verifier: randomBytes(40).toString('base64url'),
      }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('issues no refresh token when offline_access was not granted', async () => {
    const { service, db, code } = await approvedCode(['roadmaps:read']);
    stubGrantInsert(db);

    const result = await service.token({
      grant_type: 'authorization_code',
      code,
      client_id: CLIENT.client_id,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
    });
    expect(result.refresh_token).toBeUndefined();
  });

  it('rejects an unsupported grant_type', async () => {
    const { service } = makeService();
    await expect(
      service.token({ grant_type: 'client_credentials' }),
    ).rejects.toMatchObject({ code: 'unsupported_grant_type' });
  });

  it('denial bounces back with access_denied and the original state', async () => {
    const ctx = makeService();
    const consentUrl = await ctx.service.beginAuthorization(authorizeQuery());
    const requestId = new URL(consentUrl).searchParams.get('request_id')!;

    const url = new URL(await ctx.service.deny(requestId));
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('st-1');
    expect(url.searchParams.get('code')).toBeNull();
  });
});

describe('OAuthService refresh rotation', () => {
  function refreshDb(row: Record<string, unknown> | null) {
    const update = jest.fn((_record: Record<string, unknown>) => ({
      eq: jest.fn(async () => ({ error: null })),
    }));
    const maybeSingle = jest.fn(async () => ({ data: row, error: null }));
    const db = {
      from: jest.fn(() => ({
        select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle })) })),
        update,
      })),
    } as any;
    return { db, update };
  }

  it('rotates the refresh token and never widens scope', async () => {
    const { db, update } = refreshDb({
      id: 'grant-1',
      user_id: 'user-1',
      client_id: CLIENT.client_id,
      client_name: 'Claude',
      scopes: ['roadmaps:read', 'offline_access'],
      revoked_at: null,
    });
    const { service } = makeService();
    (service as any).db = db;

    const result = await service.token({
      grant_type: 'refresh_token',
      refresh_token: 'mcpr_old',
      client_id: CLIENT.client_id,
      // Asking for more than the grant carries must not escalate.
      scope: 'roadmaps:read roadmaps:write',
    });

    expect(result.refresh_token).toMatch(/^mcpr_/);
    expect(result.refresh_token).not.toBe('mcpr_old');
    // Narrowed to what the grant carries, and offline_access is retained so the
    // client can keep refreshing.
    expect(String(result.scope).split(' ').sort()).toEqual([
      'offline_access',
      'roadmaps:read',
    ]);

    const written = update.mock.calls[0][0] as Record<string, unknown>;
    expect(written.rotated_from).toBe(
      createHash('sha256').update('mcpr_old').digest('hex'),
    );
  });

  it('rejects a refresh against a revoked connection', async () => {
    const { db } = refreshDb({
      id: 'grant-1',
      user_id: 'user-1',
      client_id: CLIENT.client_id,
      client_name: 'Claude',
      scopes: ['roadmaps:read'],
      revoked_at: new Date().toISOString(),
    });
    const { service } = makeService();
    (service as any).db = db;

    await expect(
      service.token({
        grant_type: 'refresh_token',
        refresh_token: 'mcpr_old',
        client_id: CLIENT.client_id,
      }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('revokes the whole chain when a rotated-out token is replayed', async () => {
    // Live lookup misses; the reuse-detection lookup finds the successor row.
    const chainUpdateEq = jest.fn(async () => ({ error: null }));
    const chainUpdate = jest.fn(() => ({ eq: chainUpdateEq }));
    let call = 0;
    const db = {
      from: jest.fn(() => {
        call += 1;
        const data =
          call === 1 ? null : { id: 'grant-9', user_id: 'u', client_id: 'c' };
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest.fn(async () => ({ data, error: null })),
            })),
          })),
          update: chainUpdate,
        };
      }),
    } as any;

    const { service } = makeService();
    (service as any).db = db;

    await expect(
      service.token({
        grant_type: 'refresh_token',
        refresh_token: 'mcpr_stolen',
        client_id: CLIENT.client_id,
      }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });

    expect(chainUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ refresh_token_hash: null }),
    );
    expect(chainUpdateEq).toHaveBeenCalledWith('id', 'grant-9');
  });
});

describe('OAuthService kill switch', () => {
  it('denies everything while MCP_OAUTH_ENABLED is unset', async () => {
    const killSwitchConfig = {
      get: (k: string) => (k === 'MCP_ENABLED' ? 'true' : undefined),
    } as unknown as ConfigService;
    const config = new OAuthConfigService(
      killSwitchConfig,
      new McpCapabilitiesService(killSwitchConfig),
    );
    const service = new OAuthService(
      {} as any,
      fakeRedis() as any,
      config,
      { resolve: jest.fn() } as unknown as OAuthClientService,
      new OAuthJwtService(config),
    );

    await expect(
      service.beginAuthorization(authorizeQuery()),
    ).rejects.toMatchObject({ code: 'temporarily_unavailable' });
  });
});
