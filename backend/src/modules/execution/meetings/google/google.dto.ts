import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

/** Window for the read-only Google events overlay; both ends required. */
export class GoogleEventsQueryDto {
  @IsISO8601() from!: string;
  @IsISO8601() to!: string;
}

/** Where to land after the consent screen (clamped to an allowlist). */
export class GoogleConnectQueryDto {
  @IsOptional() @IsString() @MaxLength(100) returnTo?: string;
}
