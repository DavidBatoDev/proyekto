import { Controller, Get, NotFoundException, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RawResponse } from '../../../common/decorators/raw-response.decorator';
import { OAuthConfigService } from './oauth-config.service';

/**
 * OAuth discovery documents.
 *
 * A dot-leading path segment is fine — path-to-regexp treats `.` as a literal —
 * and `.well-known/*splat` is in the setGlobalPrefix exclude list so these serve
 * at the domain root where every OAuth client looks for them.
 *
 * While MCP_OAUTH_ENABLED is unset the documents 404, which (together with the
 * absent WWW-Authenticate challenge) keeps Phase 3 fully dark.
 */
@Controller('.well-known')
export class WellKnownController {
  constructor(private readonly config: OAuthConfigService) {}

  private assertEnabled(): void {
    if (!this.config.enabled) {
      throw new NotFoundException();
    }
  }

  private send(res: Response, body: Record<string, unknown>): void {
    // Discovery documents are fetched cross-origin by MCP clients and are not
    // user-specific; CORP would otherwise be `same-origin` from helmet.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(body);
  }

  /**
   * RFC 9728. Served at both the bare path and the resource-path-qualified one
   * because a client may probe either: Claude tries
   * `/.well-known/oauth-protected-resource/<mcp path>` first, then the bare form.
   */
  @Get('oauth-protected-resource')
  @RawResponse()
  protectedResource(@Res() res: Response): void {
    this.assertEnabled();
    this.send(res, this.protectedResourceDocument());
  }

  @Get('oauth-protected-resource/mcp')
  @RawResponse()
  protectedResourceForMcp(@Res() res: Response): void {
    this.assertEnabled();
    this.send(res, this.protectedResourceDocument());
  }

  private protectedResourceDocument(): Record<string, unknown> {
    return {
      // MUST byte-match the URL the user types into their MCP host.
      resource: this.config.resource,
      // Claude uses the FIRST entry and does not fall back — list only ours.
      authorization_servers: [this.config.issuer],
      scopes_supported: [...this.config.supportedScopes()],
      bearer_methods_supported: ['header'],
      resource_documentation: 'https://proyekto.tech',
    };
  }

  /** RFC 8414 authorization server metadata. */
  @Get('oauth-authorization-server')
  @RawResponse()
  authorizationServer(@Res() res: Response): void {
    this.assertEnabled();
    this.send(res, this.authorizationServerDocument());
  }

  /** Some clients probe the resource-qualified AS path too. */
  @Get('oauth-authorization-server/mcp')
  @RawResponse()
  authorizationServerForMcp(@Res() res: Response): void {
    this.assertEnabled();
    this.send(res, this.authorizationServerDocument());
  }

  private authorizationServerDocument(): Record<string, unknown> {
    const issuer = this.config.issuer;
    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      scopes_supported: [...this.config.supportedScopes()],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      // Claude verifies S256 support here before starting the flow.
      code_challenge_methods_supported: ['S256'],
      // Both flags are required for Claude to choose CIMD over DCR: it
      // authenticates as a public client at the token endpoint.
      client_id_metadata_document_supported: true,
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      revocation_endpoint_auth_methods_supported: ['none'],
      service_documentation: 'https://proyekto.tech',
    };
  }
}
