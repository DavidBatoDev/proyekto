/**
 * Real-DB end-to-end test for the MCP OAuth 2.1 authorization server (Phase 3).
 *
 * Drives the complete flow the way a real MCP host does: discovery → DCR →
 * /authorize → consent (as a logged-in user) → /token with PKCE → an actual
 * `tools/call` on /mcp with the resulting access token → refresh → revoke.
 *
 * MCP_ENABLED + MCP_OAUTH_ENABLED are forced on for this process only (prod
 * ships dark). Self-cleaning via the shared Harness; the registered client and
 * the grant rows are torn down in afterAll.
 */
process.env.MCP_ENABLED = 'true';
process.env.MCP_OAUTH_ENABLED = 'true';
process.env.MCP_OAUTH_JWT_SECRET =
  process.env.MCP_OAUTH_JWT_SECRET ??
  'integration-test-mcp-oauth-signing-secret-value';
process.env.MCP_OAUTH_ISSUER = 'http://127.0.0.1:3001';
process.env.MCP_OAUTH_RESOURCE = 'http://127.0.0.1:3001/mcp';

import { createHash, randomBytes } from 'crypto';
import request from 'supertest';
import { Harness } from './harness';

jest.setTimeout(120000);

const MCP_ACCEPT = 'application/json, text/event-stream';
const RESOURCE = 'http://127.0.0.1:3001/mcp';
const REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';

describe('MCP OAuth 2.1 authorization server (Phase 3)', () => {
  const h = new Harness();

  let owner: Awaited<ReturnType<Harness['createUser']>>;
  let projectId: string;
  let roadmapId: string;
  let clientId: string;
  const createdClientIds: string[] = [];
  const createdGrantUserIds: string[] = [];

  const verifier = randomBytes(40).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const rpc = (bearer: string, body: unknown) =>
    request(h.server())
      .post('/mcp')
      .set('Authorization', `Bearer ${bearer}`)
      .set('Accept', MCP_ACCEPT)
      .set('Content-Type', 'application/json')
      .send(body as object);

  beforeAll(async () => {
    await h.boot();
    owner = await h.createUser('mcp-oauth-owner');
    projectId = await h.createProject(owner.id);
    await h.grantAccess(projectId, owner.id, 'owner');
    roadmapId = await h.createRoadmap(owner.id, projectId);
    const epicId = await h.createEpic(roadmapId);
    await h.createFeature(epicId, roadmapId);
  });

  afterAll(async () => {
    // Grants and DCR clients are not Harness-tracked (they are created by the
    // flow under test rather than seeded), so clean them explicitly. Grants
    // would cascade with the user anyway; this makes the intent obvious.
    const admin = (h as unknown as { admin: any }).admin;
    for (const userId of createdGrantUserIds) {
      await admin.from('mcp_oauth_grants').delete().eq('user_id', userId);
    }
    for (const id of createdClientIds) {
      await admin.from('mcp_oauth_clients').delete().eq('client_id', id);
    }
    await h.cleanup();
    await h.close();
  });

  // ── Discovery ─────────────────────────────────────────────────────────────

  it('serves protected-resource metadata whose resource matches the MCP URL', async () => {
    const res = await request(h.server())
      .get('/.well-known/oauth-protected-resource/mcp')
      .expect(200);

    // Byte-match matters: a client compares this to the URL the user typed.
    expect(res.body.resource).toBe(RESOURCE);
    expect(res.body.authorization_servers).toEqual(['http://127.0.0.1:3001']);
    expect(res.body.scopes_supported).toEqual(
      expect.arrayContaining([
        'roadmaps:read',
        'tasks:write',
        'offline_access',
      ]),
    );
  });

  it('advertises S256 PKCE, CIMD support, and a registration endpoint', async () => {
    const res = await request(h.server())
      .get('/.well-known/oauth-authorization-server')
      .expect(200);

    expect(res.body.code_challenge_methods_supported).toEqual(['S256']);
    // Claude only selects CIMD when BOTH of these are present.
    expect(res.body.client_id_metadata_document_supported).toBe(true);
    expect(res.body.token_endpoint_auth_methods_supported).toContain('none');
    expect(res.body.registration_endpoint).toBe(
      'http://127.0.0.1:3001/oauth/register',
    );
  });

  it('challenges an unauthenticated /mcp call with the metadata pointer', async () => {
    const res = await request(h.server())
      .post('/mcp')
      .set('Accept', MCP_ACCEPT)
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(401);

    expect(res.headers['www-authenticate']).toContain(
      'resource_metadata="http://127.0.0.1:3001/.well-known/oauth-protected-resource/mcp"',
    );
  });

  // ── Registration ──────────────────────────────────────────────────────────

  it('registers a client via RFC 7591 dynamic client registration', async () => {
    const res = await request(h.server())
      .post('/oauth/register')
      .set('Content-Type', 'application/json')
      .send({
        client_name: 'Integration Test Host',
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: 'none',
      })
      .expect(201);

    expect(res.body.client_id).toMatch(/^mcp_/);
    expect(res.body.client_secret).toBeUndefined(); // public client
    clientId = res.body.client_id;
    createdClientIds.push(clientId);
  });

  it('rejects a registration with an unusable redirect_uri', async () => {
    const res = await request(h.server())
      .post('/oauth/register')
      .set('Content-Type', 'application/json')
      .send({ client_name: 'Bad', redirect_uris: ['ftp://nope/cb'] })
      .expect(400);
    expect(res.body.error).toBe('invalid_redirect_uri');
  });

  // ── Authorize + consent ───────────────────────────────────────────────────

  const authorizeUrl = (overrides: Record<string, string> = {}) => {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: 'roadmaps:read roadmaps:write offline_access',
      state: 'state-123',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: RESOURCE,
      ...overrides,
    });
    return `/oauth/authorize?${params.toString()}`;
  };

  it('redirects /authorize to the consent screen with a request id', async () => {
    const res = await request(h.server()).get(authorizeUrl()).expect(302);
    const location = new URL(res.headers.location);
    expect(location.pathname).toBe('/oauth/authorize');
    expect(location.searchParams.get('request_id')).toBeTruthy();
  });

  it('refuses an unregistered redirect_uri instead of bouncing the user to it', async () => {
    const res = await request(h.server())
      .get(authorizeUrl({ redirect_uri: 'https://evil.example/steal' }))
      .expect(400);
    expect(res.body.error).toBe('invalid_redirect_uri');
    expect(res.headers.location).toBeUndefined();
  });

  it('reports a non-S256 challenge back to the validated redirect_uri', async () => {
    const res = await request(h.server())
      .get(authorizeUrl({ code_challenge_method: 'plain' }))
      .expect(302);
    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get('error')).toBe('invalid_request');
    expect(location.searchParams.get('state')).toBe('state-123');
  });

  it('requires a session to read the consent request', async () => {
    await request(h.server())
      .get('/api/mcp/oauth/consent?request_id=whatever')
      .expect(401);
  });

  // ── The full happy path ───────────────────────────────────────────────────

  let accessToken: string;
  let refreshToken: string;

  it('completes authorize → consent → token and returns a usable access token', async () => {
    const authorizeRes = await request(h.server())
      .get(authorizeUrl())
      .expect(302);
    const requestId = new URL(authorizeRes.headers.location).searchParams.get(
      'request_id',
    ) as string;

    // The consent screen reads what is being asked for…
    const consentRes = await request(h.server())
      .get(`/api/mcp/oauth/consent?request_id=${requestId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(consentRes.body.data.client_name).toBe('Integration Test Host');
    expect(consentRes.body.data.requested_scopes).toEqual(
      expect.arrayContaining(['roadmaps:read', 'roadmaps:write']),
    );

    // …and the user approves READ ONLY, declining the write scope.
    const approveRes = await request(h.server())
      .post('/api/mcp/oauth/consent')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        request_id: requestId,
        granted_scopes: ['roadmaps:read', 'offline_access'],
      })
      .expect(200);

    const redirectTo = new URL(approveRes.body.data.redirect_to);
    expect(redirectTo.origin + redirectTo.pathname).toBe(REDIRECT_URI);
    expect(redirectTo.searchParams.get('state')).toBe('state-123');
    const code = redirectTo.searchParams.get('code') as string;
    expect(code).toMatch(/^mcpc_/);

    createdGrantUserIds.push(owner.id);

    const tokenRes = await request(h.server())
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      })
      .expect(200);

    expect(tokenRes.body.token_type).toBe('Bearer');
    expect(tokenRes.body.scope).toContain('roadmaps:read');
    expect(tokenRes.body.scope).not.toContain('roadmaps:write');
    expect(tokenRes.headers['cache-control']).toContain('no-store');

    accessToken = tokenRes.body.access_token;
    refreshToken = tokenRes.body.refresh_token;
    expect(refreshToken).toMatch(/^mcpr_/);
  });

  it('drives a real MCP tool call with the OAuth access token', async () => {
    const res = await rpc(accessToken, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'roadmap_get_summary',
        arguments: { roadmap_id: roadmapId },
      },
    }).expect(200);

    expect(res.body.result?.isError).toBeFalsy();
    expect(JSON.parse(res.body.result.content[0].text)).toBeDefined();
  });

  it('cannot write with a token the user only granted read scopes to', async () => {
    const res = await rpc(accessToken, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'roadmap_preview_operations',
        arguments: {
          roadmap_id: roadmapId,
          operations: [{ op: 'add_epic', title: 'Should never exist' }],
        },
      },
    }).expect(200);

    expect(res.body.result?.isError).toBe(true);
    expect(res.body.result.content[0].text).toContain('FORBIDDEN');
  });

  it('refuses to redeem the authorization code a second time', async () => {
    // Re-run authorize/consent to get a fresh code, burn it, then replay.
    const authorizeRes = await request(h.server())
      .get(authorizeUrl())
      .expect(302);
    const requestId = new URL(authorizeRes.headers.location).searchParams.get(
      'request_id',
    ) as string;
    const approveRes = await request(h.server())
      .post('/api/mcp/oauth/consent')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ request_id: requestId, granted_scopes: ['roadmaps:read'] })
      .expect(200);
    const code = new URL(approveRes.body.data.redirect_to).searchParams.get(
      'code',
    ) as string;

    const body = {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    };
    await request(h.server())
      .post('/oauth/token')
      .type('form')
      .send(body)
      .expect(200);
    const replay = await request(h.server())
      .post('/oauth/token')
      .type('form')
      .send(body)
      .expect(400);
    expect(replay.body.error).toBe('invalid_grant');
  });

  it('rotates the refresh token and keeps the old one from working', async () => {
    const first = await request(h.server())
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      })
      .expect(200);

    const rotated = first.body.refresh_token as string;
    expect(rotated).toMatch(/^mcpr_/);
    expect(rotated).not.toBe(refreshToken);

    // Replaying the rotated-out token is token theft: it fails AND kills the
    // whole chain, so the successor stops working too.
    const replay = await request(h.server())
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      })
      .expect(400);
    expect(replay.body.error).toBe('invalid_grant');

    const afterBreach = await request(h.server())
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        refresh_token: rotated,
        client_id: clientId,
      })
      .expect(400);
    expect(afterBreach.body.error).toBe('invalid_grant');
  });

  it('lists the connection in settings and revokes it', async () => {
    const listRes = await request(h.server())
      .get('/api/mcp/oauth/grants')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    const grants = listRes.body.data as Array<{ id: string }>;
    // The reuse-detection test above revoked one chain; whatever remains live
    // must still be revocable through the settings surface.
    if (grants.length > 0) {
      await request(h.server())
        .delete(`/api/mcp/oauth/grants/${grants[0].id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(204);

      await request(h.server())
        .delete(`/api/mcp/oauth/grants/${grants[0].id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(404);
    }
  });

  it('rejects an unsupported grant type with an RFC 6749 flat error', async () => {
    const res = await request(h.server())
      .post('/oauth/token')
      .type('form')
      .send({ grant_type: 'client_credentials', client_id: clientId })
      .expect(400);

    // Flat shape, NOT the app's {error:{...}} envelope.
    expect(res.body).toEqual(
      expect.objectContaining({ error: 'unsupported_grant_type' }),
    );
  });

  it('leaves the PAT routes under /api (the prefix-exclude regression check)', async () => {
    await request(h.server())
      .get('/api/mcp/tokens')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
  });
});
