// backend/src/modules/execution/time/guards/time-guest.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import { timeNotFound } from '../time-errors';

export const TIME_GUEST_EMPTY_SHAPE = 'time:guest-empty-shape';
/** The handler returns an empty shape for guests instead of 404 (D08). */
export const AllowGuestEmptyShape = () =>
  SetMetadata(TIME_GUEST_EMPTY_SHAPE, true);

/** After SupabaseAuthGuard: `user.is_guest` → NotFoundException (TIME_NOT_FOUND) unless the handler has
 *  AllowGuestEmptyShape. Public routes (IS_PUBLIC_KEY) pass through untouched. */
@Injectable()
export class TimeGuestGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets))
      return true;

    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    if (!request?.user?.is_guest) return true;

    if (
      this.reflector.getAllAndOverride<boolean>(TIME_GUEST_EMPTY_SHAPE, targets)
    )
      return true;
    // 404, never 403: a guest learns nothing about what exists (D08, E66).
    throw timeNotFound('scope');
  }
}
