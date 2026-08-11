import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

/**
 * The consent screen's approval payload. Unlike the spec-facing OAuth endpoints
 * this is our own API with a closed parameter set, so it gets a normal
 * class-validator DTO and the global ValidationPipe.
 *
 * Note there is no user id here — the approving user is always the caller
 * resolved by SupabaseAuthGuard.
 */
export class ApproveConsentDto {
  @IsString()
  @MaxLength(200)
  request_id!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  granted_scopes!: string[];
}

export class DenyConsentDto {
  @IsString()
  @MaxLength(200)
  request_id!: string;
}
