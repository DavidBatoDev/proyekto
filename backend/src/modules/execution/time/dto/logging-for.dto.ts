// dto/logging-for.dto.ts
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { ContextKind, LoggingForRequest } from '../time.types';

/** `<kind>:<uuid>` for a governed context, `personal:` for "Just me". */
export const LOGGING_FOR_REF_PATTERN =
  /^(assignment|team|workspace):[0-9a-fA-F-]{36}$|^personal:$/;

export class LoggingForDto implements LoggingForRequest {
  @IsIn(['assignment', 'team', 'workspace', 'personal']) kind!: ContextKind;
  @ValidateIf((o: LoggingForDto) => o.kind !== 'personal') @IsUUID() id?:
    | string
    | null;
}

export class PutLoggingForDto {
  /** IsDefined: ValidateNested alone lets a missing object through. */
  @IsDefined()
  @ValidateNested()
  @Type(() => LoggingForDto)
  logging_for!: LoggingForDto;
}

export class LoggingForQueryDto {
  @IsOptional() @IsISO8601() at?: string;
}

/** ?for=<kind>:<id> (personal: "personal:") */
export class PolicyQueryDto {
  @IsOptional() @Matches(LOGGING_FOR_REF_PATTERN) for?: string;
}

/** Parses a `for` query value (validated by LOGGING_FOR_REF_PATTERN) into a request; null when absent. */
export function parseLoggingForRef(
  value: string | null | undefined,
): LoggingForRequest | null {
  if (!value) return null;
  const sep = value.indexOf(':');
  if (sep < 0) return null;
  const kind = value.slice(0, sep) as ContextKind;
  const id = value.slice(sep + 1);
  return kind === 'personal' ? { kind, id: null } : { kind, id };
}
