// dto/reports.dto.ts
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import type {
  ContextKind,
  ReportGroupBy,
  TimesheetStatus,
} from '../time.types';

export class ReportQueryDto {
  @Matches(/^(team|project|workspace|engagement):[0-9a-fA-F-]{36}$/)
  scope!: string;
  @IsISO8601({ strict: true }) from!: string;
  @IsISO8601({ strict: true }) to!: string;
  @IsOptional() @IsUUID() member_user_id?: string;
  @IsOptional()
  @IsIn(['open', 'submitted', 'returned', 'approved'])
  status?: TimesheetStatus;
  @IsOptional()
  @IsIn(['assignment', 'team', 'workspace'])
  context_kind?: Exclude<ContextKind, 'personal'>;
  /** Summary grouping. `week` (A5) is the policy week of the scope. Entries and export accept it and ignore it. */
  @IsOptional()
  @IsIn(['day', 'week', 'member', 'project', 'task', 'context'])
  group_by?: ReportGroupBy;
  @IsOptional() @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @IsInt() @Min(1) @Max(200) limit?: number = 100;
  @IsOptional() @IsIn(['csv', 'xlsx']) format?: 'csv' | 'xlsx';
}

export class AuditExportQueryDto {
  @Matches(/^workspace:[0-9a-fA-F-]{36}$/) scope!: string;
  @IsISO8601({ strict: true }) from!: string;
  @IsISO8601({ strict: true }) to!: string;
  @IsOptional() @IsIn(['csv', 'xlsx']) format?: 'csv' | 'xlsx';
}
