import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Return paths are relative-only, on purpose.
 *
 * These are joined to CLIENT_URL server-side and handed to the provider as the URL a
 * customer is sent back to. Accepting an absolute URL would make this an open
 * redirect that a user arrives at holding a freshly authenticated session — the
 * worst possible moment to be forwarded to an attacker's page.
 */
const RELATIVE_PATH = /^\/[A-Za-z0-9\-._~/?#[\]@!$&'()*+,;=%]*$/;

const RELATIVE_PATH_MESSAGE =
  'Must be a relative path beginning with "/" — absolute URLs are rejected.';

export class CreateCheckoutSessionDto {
  // 'enterprise' is absent deliberately: it is quoted, not self-serve, and
  // 'free' has no provider price at all.
  @IsIn(['pro', 'business'])
  plan!: 'pro' | 'business';

  @IsIn(['month', 'year'])
  interval!: 'month' | 'year';

  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Matches(RELATIVE_PATH, { message: RELATIVE_PATH_MESSAGE })
  success_path?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Matches(RELATIVE_PATH, { message: RELATIVE_PATH_MESSAGE })
  cancel_path?: string;
}

export class CreatePortalSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Matches(RELATIVE_PATH, { message: RELATIVE_PATH_MESSAGE })
  return_path?: string;
}
