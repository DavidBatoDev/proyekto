import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { McpAuthGuard, McpAuthenticatedRequest } from './mcp-auth.guard';
import { McpTokenService } from './mcp-token.service';
import { McpCapabilitiesService } from './mcp-capabilities.service';
import { MCP_READ_SCOPES, MCP_WRITE_SCOPES } from './mcp-scopes';
import { OAuthConfigService } from './oauth/oauth-config.service';
import { OAuthJwtService } from './oauth/oauth-jwt.service';

const JWT_SECRET = 'test-secret';
const OAUTH_SECRET = 'oauth-secret-that-is-at-least-32-chars-long';
const ISSUER = 'https://api.example.test';
const RESOURCE = `${ISSUER}/mcp`;

function contextFor(headers: Record<string, string>) {
  const request = { headers } as unknown as McpAuthenticatedRequest;
  const setHeader = jest.fn();
  return {
    request,
    setHeader,
    ctx: {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ setHeader }),
      }),
    } as any,
  };
}

function makeGuard(
  enabled: boolean,
  resolveToken: jest.Mock,
  oauthEnabled = false,
): { guard: McpAuthGuard; oauthJwt: OAuthJwtService } {
  const values: Record<string, string | undefined> = {
    MCP_ENABLED: enabled ? 'true' : undefined,
    MCP_OAUTH_ENABLED: oauthEnabled ? 'true' : undefined,
    MCP_OAUTH_JWT_SECRET: OAUTH_SECRET,
    MCP_OAUTH_ISSUER: ISSUER,
    MCP_OAUTH_RESOURCE: RESOURCE,
    SUPABASE_JWT_SECRET: JWT_SECRET,
  };
  const config = {
    get: (key: string) => values[key],
  } as unknown as ConfigService;

  const tokens = { resolveToken } as unknown as McpTokenService;
  const oauthConfig = new OAuthConfigService(
    config,
    new McpCapabilitiesService(config),
  );
  const oauthJwt = new OAuthJwtService(oauthConfig);
  return {
    guard: new McpAuthGuard(config, tokens, oauthConfig, oauthJwt),
    oauthJwt,
  };
}

describe('McpAuthGuard', () => {
  it('returns 503 when MCP is disabled (kill switch)', async () => {
    const { guard } = makeGuard(false, jest.fn());
    const { ctx } = contextFor({ authorization: 'Bearer pk_whatever' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('rejects a request with no bearer token', async () => {
    const { guard } = makeGuard(true, jest.fn());
    const { ctx } = contextFor({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('resolves a valid PAT to its owner + scopes', async () => {
    const resolveToken = jest.fn().mockResolvedValue({
      id: 't1',
      user_id: 'user-1',
      scopes: ['roadmaps:read'],
      expires_at: null,
      revoked_at: null,
    });
    const { guard } = makeGuard(true, resolveToken);
    const { ctx, request } = contextFor({ authorization: 'Bearer pk_abc' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'user-1' });
    expect(request.mcpScopes).toEqual(['roadmaps:read']);
    expect(resolveToken).toHaveBeenCalledWith('pk_abc');
  });

  it('rejects a revoked/expired/unknown PAT', async () => {
    const resolveToken = jest.fn().mockResolvedValue(null);
    const { guard } = makeGuard(true, resolveToken);
    const { ctx } = contextFor({ authorization: 'Bearer pk_dead' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('accepts a live Supabase JWT (dev fallback) with all read scopes', async () => {
    const { guard } = makeGuard(true, jest.fn());
    const token = jwt.sign(
      { sub: 'user-2', email: 'dev@example.com' },
      JWT_SECRET,
      { algorithm: 'HS256' },
    );
    const { ctx, request } = contextFor({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user.id).toBe('user-2');
    // Derived from MCP_READ_SCOPES, so a read scope added later cannot miss
    // this branch — and, structurally, no write scope can ever appear here.
    expect(request.mcpScopes).toEqual([...MCP_READ_SCOPES]);
    for (const write of MCP_WRITE_SCOPES) {
      expect(request.mcpScopes).not.toContain(write);
    }
  });

  it('rejects a non-PAT bearer that fails Supabase verification', async () => {
    const { guard } = makeGuard(true, jest.fn());
    const { ctx } = contextFor({ authorization: 'Bearer not-a-real-jwt' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  describe('OAuth access tokens', () => {
    it('accepts an MCP access token and takes scopes from the token', async () => {
      const { guard, oauthJwt } = makeGuard(true, jest.fn(), true);
      const { token } = oauthJwt.mintAccessToken({
        userId: 'user-3',
        clientId: 'https://claude.ai/oauth/claude-code-client-metadata',
        scopes: ['roadmaps:read', 'tasks:write'],
        resource: RESOURCE,
      });
      const { ctx, request } = contextFor({ authorization: `Bearer ${token}` });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(request.user).toEqual({ id: 'user-3' });
      expect(request.mcpScopes).toEqual(['roadmaps:read', 'tasks:write']);
    });

    it('rejects a token minted for a different audience', async () => {
      const { guard } = makeGuard(true, jest.fn(), true);
      const foreign = jwt.sign({ scope: 'roadmaps:read' }, OAUTH_SECRET, {
        algorithm: 'HS256',
        subject: 'user-4',
        audience: 'https://someone-else.example/mcp',
        issuer: ISSUER,
        expiresIn: 60,
      });
      const { ctx } = contextFor({ authorization: `Bearer ${foreign}` });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('ignores MCP access tokens entirely while OAuth is dark', async () => {
      // Minted by a server where OAuth is on, presented to one where it is off.
      const { oauthJwt } = makeGuard(true, jest.fn(), true);
      const { token } = oauthJwt.mintAccessToken({
        userId: 'user-5',
        clientId: 'c',
        scopes: ['roadmaps:read'],
        resource: RESOURCE,
      });

      const { guard } = makeGuard(true, jest.fn(), false);
      const { ctx } = contextFor({ authorization: `Bearer ${token}` });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('emits the RFC 9728 challenge on a 401 once OAuth is live', async () => {
      const { guard } = makeGuard(true, jest.fn(), true);
      const { ctx, setHeader } = contextFor({});
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(setHeader).toHaveBeenCalledWith(
        'WWW-Authenticate',
        expect.stringContaining(
          `resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp"`,
        ),
      );
    });

    it('emits no challenge while OAuth is dark', async () => {
      const { guard } = makeGuard(true, jest.fn(), false);
      const { ctx, setHeader } = contextFor({});
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(setHeader).not.toHaveBeenCalled();
    });
  });
});
