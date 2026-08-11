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
import { isActiveConsultantEnrollment } from '../auth/consultant-capability';

/**
 * Gate consultant-only surfaces on completed vetting
 * (consultant_profiles.status='verified'). Vetting is a stateful marketplace
 * enrollment; there is no account role.
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

    const isActive = await isActiveConsultantEnrollment(
      this.supabaseAdmin,
      request.user.id,
    );

    if (!isActive) {
      throw new ForbiddenException(
        'Active consultant access is required for this resource',
      );
    }
    return true;
  }
}
