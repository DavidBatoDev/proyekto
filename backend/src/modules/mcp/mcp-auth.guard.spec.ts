import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { McpAuthGuard, McpAuthenticatedRequest } from './mcp-auth.guard';
import { McpTokenService } from './mcp-token.service';

const JWT_SECRET = 'test-secret';

function contextFor(headers: Record<string, string>) {
  const request = { headers } as unknown as McpAuthenticatedRequest;
  return {
    request,
    ctx: {
      switchToHttp: () => ({ getRequest: () => request }),
    } as any,
  };
}

function makeGuard(
  enabled: boolean,
  resolveToken: jest.Mock,
): { guard: McpAuthGuard } {
  const config = {
    get: (key: string) =>
      key === 'MCP_ENABLED'
        ? enabled
          ? 'true'
          : undefined
        : key === 'SUPABASE_JWT_SECRET'
          ? JWT_SECRET
          : undefined,
  } as unknown as ConfigService;
  const tokens = { resolveToken } as unknown as McpTokenService;
  return { guard: new McpAuthGuard(config, tokens) };
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
    expect(request.mcpScopes).toContain('roadmaps:read');
    expect(request.mcpScopes).toContain('chat:read');
  });

  it('rejects a non-PAT bearer that fails Supabase verification', async () => {
    const { guard } = makeGuard(true, jest.fn());
    const { ctx } = contextFor({ authorization: 'Bearer not-a-real-jwt' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
