import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const ROADMAP_NOTE_COLORS = [
  'yellow',
  'blue',
  'green',
  'pink',
  'purple',
  'gray',
] as const;
export type RoadmapNoteColor = (typeof ROADMAP_NOTE_COLORS)[number];

/** Mirrors roadmap_notes_position_bounds, so the DB CHECK is never what the user hears from. */
export const NOTE_POSITION_MIN = -20000;
export const NOTE_POSITION_MAX = 20000;
export const NOTE_BODY_MAX = 2000;

/**
 * Note that every field is declared even where it is optional: the global
 * ValidationPipe runs whitelist + forbidNonWhitelisted, so an undeclared field
 * 400s the request rather than being ignored.
 *
 * The target ids and coordinates are `| null` rather than merely optional
 * because UNPINNING a note has to send explicit nulls — `@IsOptional()` skips
 * validation for both `undefined` and `null`, which is exactly what that needs.
 */
export class CreateRoadmapNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(NOTE_BODY_MAX)
  body!: string;

  @IsOptional()
  @IsIn(ROADMAP_NOTE_COLORS)
  color?: RoadmapNoteColor;

  @IsOptional()
  @IsUUID()
  epic_id?: string | null;

  @IsOptional()
  @IsUUID()
  feature_id?: string | null;

  @IsOptional()
  @IsUUID()
  task_id?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(NOTE_POSITION_MIN)
  @Max(NOTE_POSITION_MAX)
  position_x?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(NOTE_POSITION_MIN)
  @Max(NOTE_POSITION_MAX)
  position_y?: number | null;
}

export class UpdateRoadmapNoteDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(NOTE_BODY_MAX)
  body?: string;

  @IsOptional()
  @IsIn(ROADMAP_NOTE_COLORS)
  color?: RoadmapNoteColor;

  @IsOptional()
  @IsUUID()
  epic_id?: string | null;

  @IsOptional()
  @IsUUID()
  feature_id?: string | null;

  @IsOptional()
  @IsUUID()
  task_id?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(NOTE_POSITION_MIN)
  @Max(NOTE_POSITION_MAX)
  position_x?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(NOTE_POSITION_MIN)
  @Max(NOTE_POSITION_MAX)
  position_y?: number | null;
}
