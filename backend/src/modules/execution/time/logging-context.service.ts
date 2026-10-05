/* eslint-disable @typescript-eslint/no-unused-vars */
// Skeleton (P03). P07 replaces the bodies; the public signatures are final (blueprint §2.8).
import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { EngagementsService } from '../../marketplace/engagements/engagements.service';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import { TimeCacheService } from './time-cache';
import { TimePolicyService } from './time-policy.service';
import type {
  LoggingForRequest,
  LoggingForResult,
  LoggingOption,
  ResolvedTimePolicy,
  ResolvePurpose,
  WritePurpose,
} from './time.types';

@Injectable()
export class LoggingContextService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly projectAuth: ProjectAuthorizationService,
    private readonly engagements: EngagementsService,
    private readonly policy: TimePolicyService,
    private readonly entitlements: EntitlementsService,
    private readonly cache: TimeCacheService,
  ) {}

  /** Steps 0–7 of backend.md "For Resolver". 404 (TIME_NOT_FOUND) when the caller has no project_access
   *  row and is not projects.owner_id. Never throws for "no options": returns options [] with reason. */
  resolve(
    callerId: string,
    projectId: string,
    o: { requested?: LoggingForRequest; at: Date; purpose: ResolvePurpose },
  ): Promise<LoggingForResult> {
    throw new NotImplementedException('P07');
  }

  /** resolve() uncached, then step 7/8: one option or 403 NO_LOGGING_CONTEXT / 422 LOGGING_FOR_INVALID
   *  ({options}) / 409 LOGGING_FOR_REQUIRED ({options, prefill}); 'alias' = prefill ?? first (D44). */
  select(
    callerId: string,
    projectId: string,
    o: {
      requested?: LoggingForRequest;
      at: Date;
      purpose: WritePurpose;
      remember?: boolean;
    },
  ): Promise<LoggingOption> {
    throw new NotImplementedException('P07');
  }

  /** Upserts time_logging_defaults (select → insert/update; one row per (user, project)). */
  remember(
    callerId: string,
    projectId: string,
    choice: LoggingForRequest,
  ): Promise<void> {
    throw new NotImplementedException('P07');
  }

  /** GET /time/projects/:projectId/policy?for= — `forRef` must be one of the caller's resolved options
   *  (else 404, never echoing ids); null = the selected/prefill/first option. Delegates to policy.resolve. */
  policyFor(
    callerId: string,
    projectId: string,
    forRef: LoggingForRequest | null,
    at: Date,
  ): Promise<ResolvedTimePolicy> {
    throw new NotImplementedException('P07');
  }
}
