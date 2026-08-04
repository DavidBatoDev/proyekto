import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

/**
 * Gate marketplace and other consultant-only surfaces by the
 * `is_consultant_verified` capability flag.
 *
 * Per specs/platform-foundations/requirements.md soft-isolation rule:
 * Verification is the durable trust signal used for consultant capabilities.
 *
 * Mirrors the philosophy of the existing `MarketplaceService.ensureConsultant`
 * helper but moves the check to the API surface so it's loud and
 * declaratively visible on the controller.
 */
@Injectable()
export class ConsultantOnlyGuard implements CanActivate {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabaseAdmin: SupabaseClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.user) {
      throw new UnauthorizedException();
    }

    const { data: profile, error } = await this.supabaseAdmin
      .from('profiles')
      .select('id, is_consultant_verified')
      .eq('id', request.user.id)
      .maybeSingle();

    if (error || !profile?.is_consultant_verified) {
      throw new ForbiddenException(
        'Consultant verification required to access this resource',
      );
    }
    return true;
  }
}
