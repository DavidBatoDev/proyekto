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
import { isActiveSellerEnrollment } from '../auth/consultant-capability';

/**
 * Gate marketplace-seller surfaces (service offerings) on either enrollment:
 * a verified consultant OR an active talent listing. Same shape as
 * ConsultantOnlyGuard, one predicate wider — both personas sell services,
 * and there is no account role.
 */
@Injectable()
export class SellerOnlyGuard implements CanActivate {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabaseAdmin: SupabaseClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.user) {
      throw new UnauthorizedException();
    }

    const isSeller = await isActiveSellerEnrollment(
      this.supabaseAdmin,
      request.user.id,
    );

    if (!isSeller) {
      throw new ForbiddenException(
        'An active seller listing (verified consultant or live talent profile) is required for this resource',
      );
    }
    return true;
  }
}
