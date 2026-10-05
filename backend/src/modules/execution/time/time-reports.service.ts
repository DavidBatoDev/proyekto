/* eslint-disable @typescript-eslint/no-unused-vars */
// Skeleton (P03). P12 replaces the bodies; the public signatures are final (blueprint §2.8).
import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { EngagementsService } from '../../marketplace/engagements/engagements.service';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import type { AuditExportQueryDto, ReportQueryDto } from './dto/reports.dto';
import { TimeAuthorityService } from './time-authority.service';
import { TimePolicyService } from './time-policy.service';
import type {
  ExportFile,
  Paged,
  ReportScope,
  ReportSummary,
  TimeEntryView,
} from './time.types';

@Injectable()
export class TimeReportsService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly authority: TimeAuthorityService,
    private readonly policy: TimePolicyService,
    private readonly entitlements: EntitlementsService,
    private readonly engagements: EngagementsService,
    private readonly projectAuth: ProjectAuthorizationService,
  ) {}

  /** 404 on miss */
  resolveScope(viewerId: string, scope: string): Promise<ReportScope> {
    throw new NotImplementedException('P12');
  }

  entries(viewerId: string, q: ReportQueryDto): Promise<Paged<TimeEntryView>> {
    throw new NotImplementedException('P12');
  }

  summary(viewerId: string, q: ReportQueryDto): Promise<ReportSummary> {
    throw new NotImplementedException('P12');
  }

  /** time_reports_export */
  export(viewerId: string, q: ReportQueryDto): Promise<ExportFile> {
    throw new NotImplementedException('P12');
  }

  /** time_audit_export */
  auditExport(viewerId: string, q: AuditExportQueryDto): Promise<ExportFile> {
    throw new NotImplementedException('P12');
  }
}
