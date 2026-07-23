import {
  ArrayNotEmpty,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class IssueMcpTokenDto {
  @IsString()
  @MaxLength(120)
  name: string;

  // Coarse OAuth-style scopes; each is re-validated against the known set in
  // McpTokenService.issueToken (unknown scope → 400).
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  scopes: string[];

  // Optional ISO-8601 expiry. Absent = non-expiring (revoke to invalidate).
  @IsOptional()
  @IsISO8601()
  expires_at?: string;
}
