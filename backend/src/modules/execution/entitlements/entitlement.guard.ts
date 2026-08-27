import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';

export type EntitlementKey = 'time_tracking';

export const ENTITLEMENT_KEY = 'required_entitlement';

/**
 * Marks a route as requiring a team add-on. The route MUST carry a `teamId`
 * param — that is the billing subject.
 */
export const RequiresEntitlement = (key: EntitlementKey) =>
  SetMetadata(ENTITLEMENT_KEY, key);

/**
 * The add-on gate, per the pricing-tiers proposal: a sibling of
 * `ConsultantOnlyGuard`, deliberately NOT a layer inside `resolvePermissions`.
 * Permissions answer "may this role do this here"; entitlement answers "has
 * this team enabled (later: paid for) the module".
 *
 * Today every add-on is free and backed by a plain team flag —
 * `time_tracking` reads `teams.time_tracking_enabled`, the column that has
 * gated the Time section since before add-ons existed. When billing ships,
 * this resolver swaps to an entitlements table without touching call sites.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<EntitlementKey | undefined>(
      ENTITLEMENT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!key) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ params?: Record<string, string> }>();
    const teamId = request.params?.teamId;
    if (!teamId) return true; // No team subject on this route — nothing to gate.

    const { data, error } = await this.supabase
      .from('teams')
      .select('time_tracking_enabled')
      .eq('id', teamId)
      .maybeSingle<{ time_tracking_enabled: boolean }>();
    if (error) throw new Error(error.message);
    if (key === 'time_tracking' && !data?.time_tracking_enabled) {
      throw new ForbiddenException({
        code: 'ADDON_NOT_ENABLED',
        message:
          'The Time add-on is not enabled for this team. The owner can enable it under Engagements → Finance → Add-ons.',
      });
    }
    return true;
  }
}
