import type { ConfigService } from '@nestjs/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Redis } from '@upstash/redis';
import { GoogleOAuthService } from './google-oauth.service';

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
  return { client: { from }, upsert, from };
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
    // state → userId stashed in Redis with a TTL.
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^gcal:oauth:state:/),
      'user-1',
      { ex: 600 },
    );
  });

  it('exchangeCode rejects an unknown/expired state', async () => {
    const { service } = make();
    redis.get.mockResolvedValue(null);

    await expect(
      service.exchangeCode('code', 'bad-state'),
    ).rejects.toMatchObject({ status: 400 });
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
