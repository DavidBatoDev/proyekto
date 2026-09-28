import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

/**
 * Narrows an admin route to `super_admin`. It reads the profile AdminGuard
 * attaches, so it must be listed after it:
 * `@UseGuards(SupabaseAuthGuard, AdminGuard, SuperAdminGuard)`.
 *
 * For writes that change what every customer gets (plan limits) or give
 * revenue away (complimentary plans). Support and moderator admins can still
 * read those surfaces through AdminGuard alone.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<
      AuthenticatedRequest & {
        adminProfile?: { access_level?: string; is_active?: boolean };
      }
    >();
    if (
      !request.adminProfile?.is_active ||
      request.adminProfile.access_level !== 'super_admin'
    ) {
      throw new ForbiddenException('Super admin access required');
    }
    return true;
  }
}
