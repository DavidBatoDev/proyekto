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
import { isActiveConsultant } from '../auth/consultant-capability';

/**
 * Gate consultant-only surfaces by durable consultant identity plus completed
 * vetting. Neither the role nor the verification flag grants access alone.
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
      .select('id, role, is_consultant_verified')
      .eq('id', request.user.id)
      .maybeSingle();

    if (error || !isActiveConsultant(profile)) {
      throw new ForbiddenException(
        'Active consultant access is required for this resource',
      );
    }
    return true;
  }
}
