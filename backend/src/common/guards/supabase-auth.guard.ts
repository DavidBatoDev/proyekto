import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import * as jwt from 'jsonwebtoken';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SUPABASE_ADMIN, SUPABASE_CLIENT } from '../../config/supabase.module';
import {
  AuthenticatedRequest,
  AuthenticatedUser,
} from '../interfaces/authenticated-request.interface';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseAuthGuard.name);
  private readonly jwtSecret?: string;
  private warnedSecretMismatch = false;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabaseClient: SupabaseClient,
    @Inject(SUPABASE_ADMIN) private readonly supabaseAdmin: SupabaseClient,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {
    this.jwtSecret = this.config.get<string>('SUPABASE_JWT_SECRET');
  }

  /**
   * Verify a Supabase access token locally (HS256) using the project JWT
   * secret — no network call. Returns the user on success, or null to signal
   * the caller should fall back to network verification. Throws only when the
   * signature is valid but the token is expired (a definitive reject that
   * doesn't need a network round-trip).
   */
  private verifyTokenLocally(token: string): AuthenticatedUser | null {
    if (!this.jwtSecret) return null;
    try {
      const payload = jwt.verify(token, this.jwtSecret, {
        algorithms: ['HS256'],
      });
      if (typeof payload === 'string' || !payload.sub) return null;
      return {
        id: String(payload.sub),
        email:
          typeof payload.email === 'string' ? payload.email : undefined,
      };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedException('Invalid or expired token');
      }
      // Bad signature / malformed: fall back to network verification so a
      // misconfigured secret never locks users out.
      return null;
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers['authorization'];

    // --- JWT auth ---
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);

      // Fast path: verify the token locally with the project JWT secret.
      const localUser = this.verifyTokenLocally(token);
      if (localUser) {
        request.user = localUser;
        return true;
      }

      // Fallback: network verification via GoTrue (no secret configured, or
      // local verification was inconclusive).
      const { data, error } = await this.supabaseClient.auth.getUser(token);

      if (error || !data.user) {
        throw new UnauthorizedException('Invalid or expired token');
      }

      // If we configured a secret but still had to verify over the network for
      // a token GoTrue accepts, the secret is almost certainly wrong. Warn once
      // so the misconfiguration (and lost speedup) is visible in logs.
      if (this.jwtSecret && !this.warnedSecretMismatch) {
        this.warnedSecretMismatch = true;
        this.logger.warn(
          'SUPABASE_JWT_SECRET is set but a valid token failed local verification — ' +
            'check the secret value. Falling back to network verification.',
        );
      }

      request.user = {
        id: data.user.id,
        email: data.user.email,
      };

      return true;
    }

    // --- Guest auth ---
    const guestSessionId = request.headers['x-guest-user-id'] as string;

    if (guestSessionId) {
      const thirtyDaysAgo = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000,
      ).toISOString();

      const { data: profile, error } = await this.supabaseAdmin
        .from('profiles')
        .select('id, guest_session_id')
        .eq('guest_session_id', guestSessionId)
        .eq('is_guest', true)
        .gt('created_at', thirtyDaysAgo)
        .single();

      if (error || !profile) {
        throw new UnauthorizedException('Invalid or expired guest session');
      }

      request.user = {
        id: profile.id as string,
        is_guest: true,
        guest_session_id: guestSessionId,
      } as AuthenticatedUser;

      return true;
    }

    throw new UnauthorizedException('No valid authentication provided');
  }
}
