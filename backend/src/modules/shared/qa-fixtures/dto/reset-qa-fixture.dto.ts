import { IsBoolean, IsOptional } from 'class-validator';

export class ResetQaFixtureDto {
  @IsOptional()
  @IsBoolean()
  mark_success?: boolean;
}
