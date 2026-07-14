import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

@Injectable()
export class ModeratorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<
      AuthenticatedRequest & {
        adminProfile?: { access_level?: string; is_active?: boolean };
      }
    >();
    if (
      !request.adminProfile?.is_active ||
      !['moderator', 'super_admin'].includes(
        request.adminProfile.access_level ?? '',
      )
    ) {
      throw new ForbiddenException('Moderator access required');
    }
    return true;
  }
}
