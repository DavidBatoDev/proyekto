import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { AuthenticatedRequest } from '../../common/interfaces/authenticated-request.interface';
import { McpTokenService } from './mcp-token.service';

/** The authenticated request as seen by MCP handlers — carries token scopes. */
export interface McpAuthenticatedRequest extends AuthenticatedRequest {
  mcpScopes?: string[];
}

/**
 * Auth for the /mcp endpoint.
 *
 *  1. Kill switch: unless MCP_ENABLED === 'true', the whole surface is 503.
 *  2. Primary: a Proyekto PAT (`Bearer pk_…`) resolved by sha256 hash to its
 *     owner + scopes. Identity is derived here, never from tool inputs.
 *  3. Fallback: a live Supabase access token (local HS256 verify, mirroring
 *     SupabaseAuthGuard) with no MCP scopes — convenient for dev/MCP Inspector.
 *     Such a session grants every read scope so a developer isn't blocked; PATs
 *     remain the least-privilege path for real hosts.
 */
@Injectable()
export class McpAuthGuard implements CanActivate {
  private readonly jwtSecret?: string;

  constructor(
    private readonly config: ConfigService,
    private readonly tokens: McpTokenService,
  ) {
    this.jwtSecret = this.config.get<string>('SUPABASE_JWT_SECRET');
  }

  private isEnabled(): boolean {
    return this.config.get<string>('MCP_ENABLED') === 'true';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('MCP server is not enabled.');
    }

    const request = context
      .switchToHttp()
      .getRequest<McpAuthenticatedRequest>();
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token.');
    }
    const token = authHeader.slice(7);

    // --- Proyekto PAT ---
    if (token.startsWith('pk_')) {
      const resolved = await this.tokens.resolveToken(token);
      if (!resolved) {
        throw new UnauthorizedException('Invalid, revoked, or expired token.');
      }
      request.user = { id: resolved.user_id };
      request.mcpScopes = resolved.scopes ?? [];
      return true;
    }

    // --- Supabase session JWT (dev / MCP Inspector) ---
    const user = this.verifySupabaseToken(token);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired token.');
    }
    request.user = user;
    // A real logged-in session may use any read tool during development.
    request.mcpScopes = [
      'projects:read',
      'roadmaps:read',
      'knowledge:read',
      'chat:read',
    ];
    return true;
  }

  private verifySupabaseToken(
    token: string,
  ): { id: string; email?: string } | null {
    if (!this.jwtSecret) return null;
    try {
      const payload = jwt.verify(token, this.jwtSecret, {
        algorithms: ['HS256'],
      });
      if (typeof payload === 'string' || !payload.sub) return null;
      return {
        id: String(payload.sub),
        email: typeof payload.email === 'string' ? payload.email : undefined,
      };
    } catch {
      return null;
    }
  }
}
