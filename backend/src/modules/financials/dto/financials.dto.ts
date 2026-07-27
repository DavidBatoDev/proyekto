import { IsDateString, IsOptional } from 'class-validator';

export class FinancialsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
