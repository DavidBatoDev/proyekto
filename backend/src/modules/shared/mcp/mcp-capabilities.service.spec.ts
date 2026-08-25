import type { ConfigService } from '@nestjs/config';
import { McpCapabilitiesService } from './mcp-capabilities.service';
import { MCP_READ_SCOPES, MCP_WRITE_SCOPES } from './mcp-scopes';
import {
  OAuthConfigService,
  OFFLINE_ACCESS,
} from './oauth/oauth-config.service';

function configWith(values: Record<string, string> = {}) {
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

function capabilities(values: Record<string, string> = {}) {
  return new McpCapabilitiesService(configWith(values));
}

describe('McpCapabilitiesService', () => {
  it('keeps chat:write dark by default', () => {
    const caps = capabilities();
    expect(caps.chatWriteEnabled).toBe(false);
    expect(caps.isScopeEnabled('chat:write')).toBe(false);
    expect(caps.enabledScopes()).not.toContain('chat:write');
  });

  it('only treats the literal string "true" as on', () => {
    expect(capabilities({ MCP_CHAT_WRITE_ENABLED: '1' }).chatWriteEnabled).toBe(
      false,
    );
    expect(
      capabilities({ MCP_CHAT_WRITE_ENABLED: 'yes' }).chatWriteEnabled,
    ).toBe(false);
    expect(
      capabilities({ MCP_CHAT_WRITE_ENABLED: 'true' }).chatWriteEnabled,
    ).toBe(true);
  });

  it('leaves every ungated scope enabled — including the Phase-5 delivery pair', () => {
    const enabled = capabilities().enabledScopes();
    for (const scope of MCP_READ_SCOPES) {
      expect(enabled).toContain(scope);
    }
    for (const scope of MCP_WRITE_SCOPES.filter((s) => s !== 'chat:write')) {
      expect(enabled).toContain(scope);
    }
    // Flagless by owner decision (2026-08-25): delivery:write is live on
    // deploy like the other write scopes.
    expect(enabled).toContain('delivery:write');
  });

  it('exposes chat:write once the flag is set', () => {
    expect(
      capabilities({ MCP_CHAT_WRITE_ENABLED: 'true' }).enabledScopes(),
    ).toContain('chat:write');
  });
});

describe('OAuth scope advertisement follows the capability gate', () => {
  const oauthEnv = {
    MCP_ENABLED: 'true',
    MCP_OAUTH_ENABLED: 'true',
    MCP_OAUTH_ISSUER: 'https://api.example.test',
  };

  const configFor = (values: Record<string, string>) => {
    const cfg = configWith(values);
    return new OAuthConfigService(cfg, new McpCapabilitiesService(cfg));
  };

  it('withholds a dark scope from discovery and the 401 challenge', () => {
    const config = configFor(oauthEnv);
    // This is what keeps chat:write off the consent screen entirely: Claude
    // only ever asks for what the challenge advertises.
    expect(config.supportedScopes()).not.toContain('chat:write');
    expect(config.defaultChallengeScopes()).not.toContain('chat:write');
    // offline_access is an OAuth signal, not a permission — always advertised.
    expect(config.supportedScopes()).toContain(OFFLINE_ACCESS);
  });

  it('advertises it once enabled', () => {
    const config = configFor({
      ...oauthEnv,
      MCP_CHAT_WRITE_ENABLED: 'true',
    });
    expect(config.supportedScopes()).toContain('chat:write');
    expect(config.defaultChallengeScopes()).toContain('chat:write');
  });
});
