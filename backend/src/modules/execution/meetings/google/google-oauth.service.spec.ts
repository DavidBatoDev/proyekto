import type { ConfigService } from '@nestjs/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Redis } from '@upstash/redis';
import {
  GoogleOAuthService,
  GoogleReconnectRequiredError,
} from './google-oauth.service';

const CONFIG: Record<string, string> = {
  GOOGLE_OAUTH_ENABLED: 'true',
  GOOGLE_OAUTH_CLIENT_ID: 'cid',
  GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://api.x/api/meetings/google/callback',
};

const config = {
  get: jest.fn((k: string) => CONFIG[k]),
  getOrThrow: jest.fn((k: string) => CONFIG[k]),
};

function makeRedis() {
  return {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn(),
    del: jest.fn().mockResolvedValue(1),
  };
}

// Minimal chainable Supabase mock returning a fixed connection row.
function makeSupabase(connection: Record<string, unknown> | null) {
  const maybeSingle = jest
    .fn()
    .mockResolvedValue({ data: connection, error: null });
  const eqSelect = jest.fn(() => ({ maybeSingle }));
  const select = jest.fn(() => ({ eq: eqSelect }));
  const upsert = jest.fn().mockResolvedValue({ error: null });
  const eqDelete = jest.fn().mockResolvedValue({ error: null });
  const del = jest.fn(() => ({ eq: eqDelete }));
  const from = jest.fn(() => ({ select, upsert, delete: del }));
  return { client: { from }, upsert, from, del, eqDelete };
}

function tokenResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

interface FetchInit {
  body?: string;
}

describe('GoogleOAuthService', () => {
  let redis: ReturnType<typeof makeRedis>;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    redis = makeRedis();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  function make(connection: Record<string, unknown> | null = null) {
    const supabase = makeSupabase(connection);
    const service = new GoogleOAuthService(
      config as unknown as ConfigService,
      supabase.client as unknown as SupabaseClient,
      redis as unknown as Redis,
    );
    return { service, supabase };
  }

  it('isEnabled reflects the flag + client credentials', () => {
    const { service } = make();
    expect(service.isEnabled()).toBe(true);
  });

  it('buildConsentUrl requests offline access + forced consent and stores the state', async () => {
    const { service } = make();
    const url = await service.buildConsentUrl('user-1');

    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
    expect(url).toContain('calendar.events');
    expect(url).toContain('state=');
    // state → {userId, returnTo} stashed in Redis with a TTL; an unknown
    // return path falls back to /meetings.
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^gcal:oauth:state:/),
      JSON.stringify({ userId: 'user-1', returnTo: '/meetings' }),
      { ex: 600 },
    );
  });

  it('buildConsentUrl keeps an allowlisted returnTo and rejects others', async () => {
    const { service } = make();
    await service.buildConsentUrl('user-1', '/settings/integrations');
    await service.buildConsentUrl('user-1', 'https://evil.example/phish');

    const stored = redis.set.mock.calls.map(
      (call: unknown[]) =>
        JSON.parse(call[1] as string) as { returnTo: string },
    );
    expect(stored[0].returnTo).toBe('/settings/integrations');
    expect(stored[1].returnTo).toBe('/meetings');
  });

  it('consumeState returns null for an unknown/expired state and deletes the key', async () => {
    const { service } = make();
    redis.get.mockResolvedValue(null);

    await expect(service.consumeState('bad-state')).resolves.toBeNull();
    expect(redis.del).toHaveBeenCalledWith('gcal:oauth:state:bad-state');
  });

  it('consumeState reads both the JSON form and a legacy bare userId', async () => {
    const { service } = make();
    // Upstash auto-deserializes JSON values into objects.
    redis.get.mockResolvedValueOnce({
      userId: 'user-1',
      returnTo: '/settings/integrations',
    });
    redis.get.mockResolvedValueOnce('user-2');

    await expect(service.consumeState('s1')).resolves.toEqual({
      userId: 'user-1',
      returnTo: '/settings/integrations',
    });
    await expect(service.consumeState('s2')).resolves.toEqual({
      userId: 'user-2',
      returnTo: '/meetings',
    });
  });

  it('getAccessToken exchanges the stored refresh token', async () => {
    const { service } = make({
      refresh_token: 'plain-rt',
      google_email: 'g@x.com',
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ access_token: 'at-123' }),
      text: () => Promise.resolve(''),
    });

    const token = await service.getAccessToken('user-1');

    expect(token).toBe('at-123');
    const [url, init] = fetchMock.mock.calls[0] as [string, FetchInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init.body).toContain('grant_type=refresh_token');
    expect(init.body).toContain('refresh_token=plain-rt');
  });

  it('getAccessToken caches a fresh token until shortly before it expires', async () => {
    const { service } = make({ refresh_token: 'plain-rt' });
    fetchMock.mockResolvedValue(
      tokenResponse({ access_token: 'at-123', expires_in: 3599 }),
    );

    await service.getAccessToken('user-1');

    expect(redis.set).toHaveBeenCalledWith('gcal:token:user-1', 'at-123', {
      ex: 3539,
    });
  });

  it('getAccessToken serves a cached token without calling Google', async () => {
    const { service, supabase } = make({ refresh_token: 'plain-rt' });
    redis.get.mockResolvedValue('cached-at');

    await expect(service.getAccessToken('user-1')).resolves.toBe('cached-at');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('getAccessToken on invalid_grant removes the connection and asks for a reconnect', async () => {
    const { service, supabase } = make({ refresh_token: 'revoked-rt' });
    fetchMock.mockResolvedValue(
      tokenResponse(
        {
          error: 'invalid_grant',
          error_description: 'Token has been expired or revoked.',
        },
        400,
      ),
    );

    const attempt = service.getAccessToken('user-1');
    await expect(attempt).rejects.toBeInstanceOf(GoogleReconnectRequiredError);
    await expect(attempt).rejects.toMatchObject({
      status: 409,
      response: { code: 'GOOGLE_RECONNECT_REQUIRED' },
    });
    expect(supabase.del).toHaveBeenCalled();
    expect(supabase.eqDelete).toHaveBeenCalledWith('user_id', 'user-1');
    expect(redis.del).toHaveBeenCalledWith('gcal:token:user-1');
  });

  it('getAccessToken keeps the connection on other token errors', async () => {
    const { service, supabase } = make({ refresh_token: 'plain-rt' });
    fetchMock.mockResolvedValue(tokenResponse({ error: 'backend' }, 503));

    await expect(service.getAccessToken('user-1')).rejects.toThrow(
      /status 503/,
    );
    expect(supabase.del).not.toHaveBeenCalled();
  });

  it('disconnect revokes at Google, then deletes the row and the cached token', async () => {
    const { service, supabase } = make({ refresh_token: 'plain-rt' });
    fetchMock.mockResolvedValue(tokenResponse({}));

    await service.disconnect('user-1');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://oauth2.googleapis.com/revoke?token=plain-rt');
    expect(supabase.eqDelete).toHaveBeenCalledWith('user_id', 'user-1');
    expect(redis.del).toHaveBeenCalledWith('gcal:token:user-1');
  });

  it('disconnect still deletes the row when the revoke call fails', async () => {
    const { service, supabase } = make({ refresh_token: 'plain-rt' });
    fetchMock.mockRejectedValue(new Error('network down'));

    await service.disconnect('user-1');

    expect(supabase.eqDelete).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('getStatus reports disabled without touching the DB', async () => {
    const disabledConfig = {
      get: jest.fn((k: string) =>
        k === 'GOOGLE_OAUTH_ENABLED' ? undefined : CONFIG[k],
      ),
      getOrThrow: jest.fn((k: string) => CONFIG[k]),
    };
    const supabase = makeSupabase(null);
    const service = new GoogleOAuthService(
      disabledConfig as unknown as ConfigService,
      supabase.client as unknown as SupabaseClient,
      redis as unknown as Redis,
    );

    expect(await service.getStatus('user-1')).toEqual({
      enabled: false,
      connected: false,
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
