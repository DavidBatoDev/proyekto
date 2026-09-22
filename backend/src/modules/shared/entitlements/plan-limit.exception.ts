import { ForbiddenException } from '@nestjs/common';
import type { PlanId, PlanLimitContext } from './entitlement-keys';

export type { PlanLimitContext } from './entitlement-keys';

/**
 * The body of every plan-limit rejection. HttpExceptionFilter spreads it under
 * `error`, so clients read `error.code === 'plan_limit'`.
 *
 * `message` is written to be read by anyone, including an invitee who is not
 * yet a member: it names the plan and the limit, never private usage detail
 * beyond the count that tripped it.
 */
export interface PlanLimitPayload {
  code: 'plan_limit';
  kind: 'count' | 'feature';
  limit_key: string;
  label: string;
  /** The plan's value; null for a feature gate. */
  limit: number | null;
  /** The count before this write; null for a feature gate. */
  used: number | null;
  plan: PlanId;
  /** The cheapest higher plan that would allow it, from the live matrix; null = contact sales. */
  upgrade_plan: PlanId | null;
  workspace_id: string | null;
  workspace_slug: string | null;
  context: PlanLimitContext;
  message: string;
}

/**
 * HTTP 403 with code `plan_limit`. Deliberately not:
 *   - 429: the agent retries 429 (execute.py _is_transient);
 *   - 402: MCP's normalizeError maps it to INTERNAL;
 *   - 409: reserved for STALE_REVISION.
 */
export class PlanLimitException extends ForbiddenException {
  readonly payload: PlanLimitPayload;

  constructor(payload: PlanLimitPayload) {
    super(payload);
    this.payload = payload;
  }
}

export function isPlanLimitException(
  error: unknown,
): error is PlanLimitException {
  return error instanceof PlanLimitException;
}
