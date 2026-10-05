// dto/preferences.dto.ts
import { IsInt, IsOptional, IsTimeZone, Max, Min } from 'class-validator';

export class UpdateTimePreferencesDto {
  @IsTimeZone() timezone!: string;
  @IsOptional() @IsInt() @Min(1) @Max(7) week_start?: number | null;
}
