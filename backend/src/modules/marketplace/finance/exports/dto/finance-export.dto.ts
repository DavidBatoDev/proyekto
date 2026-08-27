import { IsIn, IsISO8601, IsOptional } from 'class-validator';

export class FinanceExportQueryDto {
  @IsIn(['time_logs', 'payouts'])
  kind!: 'time_logs' | 'payouts';

  @IsIn(['csv', 'xlsx', 'pdf'])
  format!: 'csv' | 'xlsx' | 'pdf';

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
