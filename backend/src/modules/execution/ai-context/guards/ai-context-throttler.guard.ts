import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';

@Injectable()
export class AiContextThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(request: {
    user?: AuthenticatedUser;
    ip: string;
  }): Promise<string> {
    // Auth runs first: users and guests keep their own quota behind a shared IP.
    return Promise.resolve(request.user?.id ?? request.ip);
  }
}
