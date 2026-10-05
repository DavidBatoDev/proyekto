// dto/timesheets.dto.ts
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { SheetScopeKind } from '../time.types';

export class TimesheetActionDto {
  @IsInt() @Min(0) expected_revision!: number;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsBoolean() approve_overtime?: boolean;
}

export class ApproveBulkDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids!: string[];
  @IsArray() @IsInt({ each: true }) expected_revisions!: number[]; // same length (service → 400)
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsBoolean() approve_overtime?: boolean;
}

export class MyTimesheetsQueryDto {
  @IsOptional() @IsISO8601({ strict: true }) from?: string;
  @IsOptional() @IsISO8601({ strict: true }) to?: string;
}

export class ApprovalsQueryDto {
  @IsOptional() @IsIn(['submitted', 'decided']) status?:
    | 'submitted'
    | 'decided' = 'submitted';
  @IsOptional() @IsISO8601({ strict: true }) since?: string;
  @IsOptional()
  @IsIn(['team', 'workspace', 'engagement'])
  scope_kind?: SheetScopeKind;
  @IsOptional() @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @IsInt() @Min(1) @Max(100) limit?: number = 50;
}
