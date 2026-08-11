import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * RFC 6749 §5.2 error codes. Anthropic's connector docs are explicit that a dead
 * refresh token MUST come back as `invalid_grant` — a custom code breaks Claude's
 * re-authorization path.
 */
export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'access_denied'
  | 'server_error'
  | 'temporarily_unavailable'
  | 'invalid_redirect_uri'
  | 'invalid_client_metadata';

/**
 * An error that must reach the wire as a FLAT RFC 6749 body
 * (`{"error":"invalid_grant","error_description":"…"}`), not the app's usual
 * `{error:{…}}` envelope. OAuthExceptionFilter does the rendering.
 */
export class OAuthError extends HttpException {
  constructor(
    readonly code: OAuthErrorCode,
    readonly description?: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super(
      {
        error: code,
        ...(description ? { error_description: description } : {}),
      },
      status,
    );
  }

  static invalidRequest(description?: string): OAuthError {
    return new OAuthError('invalid_request', description);
  }

  static invalidGrant(description?: string): OAuthError {
    return new OAuthError('invalid_grant', description);
  }

  static invalidClient(description?: string): OAuthError {
    // RFC 6749 §5.2: invalid_client MAY be 401.
    return new OAuthError(
      'invalid_client',
      description,
      HttpStatus.UNAUTHORIZED,
    );
  }

  static invalidScope(description?: string): OAuthError {
    return new OAuthError('invalid_scope', description);
  }
}
