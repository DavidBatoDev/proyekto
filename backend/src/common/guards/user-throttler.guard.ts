import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../interfaces/authenticated-request.interface';

/**
 * A ThrottlerGuard keyed on the authenticated user rather than the IP.
 *
 * ThrottlerModule is configured in app.module.ts but is deliberately NOT bound
 * as a global guard, so `@Throttle` is inert unless a controller opts in with
 * `@UseGuards(...)`. Bind this one alongside `@Throttle` on any route where a
 * single account can create unbounded rows.
 *
 * Auth runs first, so `request.user` is populated; the IP fallback keeps
 * unauthenticated routes from sharing one bucket under a NAT.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(request: {
    user?: AuthenticatedUser;
    ip: string;
  }): Promise<string> {
    return Promise.resolve(request.user?.id ?? request.ip);
  }
}
