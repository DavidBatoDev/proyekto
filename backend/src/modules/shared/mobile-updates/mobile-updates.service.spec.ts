import { MobileUpdatesService } from './mobile-updates.service';
import type { CapgoCheckBody } from './dto/capgo.types';

// Chainable Supabase query-builder mock that records calls and resolves
// `.maybeSingle()` to a configured result.
function makeSupabase(result: { data: unknown; error: unknown }) {
  const builder: Record<string, jest.Mock> = {};
  for (const m of ['select', 'eq', 'lte', 'order', 'limit']) {
    builder[m] = jest.fn(() => builder);
  }
  builder.maybeSingle = jest.fn(() => Promise.resolve(result));
  const from = jest.fn(() => builder);
  return { supabase: { from } as never, builder, from };
}

const baseBody: CapgoCheckBody = {
  platform: 'android',
  version_build: '1',
  version_name: '1.5',
  defaultChannel: 'production',
};

const make = (result: { data: unknown; error: unknown }) => {
  const m = makeSupabase(result);
  // R2 client/config are unused by resolveUpdate.
  const svc = new MobileUpdatesService(m.supabase, {} as never, {} as never);
  return { svc, ...m };
};

describe('MobileUpdatesService.resolveUpdate', () => {
  it('returns no-update when the device is already on the latest version', async () => {
    const { svc } = make({
      data: { version: '1.5', url: 'u', checksum: 'c' },
      error: null,
    });
    const res = await svc.resolveUpdate(baseBody);
    expect(res).toEqual({
      error: 'no_new_version_available',
      message: 'up to date',
    });
  });

  it('returns the bundle when a newer one exists', async () => {
    const { svc } = make({
      data: { version: '1.6', url: 'https://cdn/x.zip', checksum: 'abc' },
      error: null,
    });
    const res = await svc.resolveUpdate(baseBody);
    expect(res).toEqual({
      version: '1.6',
      url: 'https://cdn/x.zip',
      checksum: 'abc',
    });
  });

  it('applies the native-compat guard with the parsed native build', async () => {
    const { svc, builder } = make({ data: null, error: null });
    await svc.resolveUpdate({ ...baseBody, version_build: '3' });
    // version_build "3" -> only bundles with native_build_min <= 3 are eligible.
    expect(builder.lte).toHaveBeenCalledWith('native_build_min', 3);
  });

  it('orders by created_at DESC (monotonic, no string-sort downgrade)', async () => {
    const { svc, builder } = make({ data: null, error: null });
    await svc.resolveUpdate(baseBody);
    expect(builder.order).toHaveBeenCalledWith('created_at', {
      ascending: false,
    });
  });

  it('filters to the requested platform + channel + published status', async () => {
    const { svc, builder } = make({ data: null, error: null });
    await svc.resolveUpdate(baseBody);
    expect(builder.eq).toHaveBeenCalledWith('platform', 'android');
    expect(builder.eq).toHaveBeenCalledWith('channel', 'production');
    expect(builder.eq).toHaveBeenCalledWith('status', 'published');
  });

  it('does not query and returns no-update on a non-numeric native build', async () => {
    const { svc, from } = make({ data: null, error: null });
    const res = await svc.resolveUpdate({ ...baseBody, version_build: 'oops' });
    expect(from).not.toHaveBeenCalled();
    expect(res).toMatchObject({ error: 'no_new_version_available' });
  });

  it('does not query and returns no-update on an unknown platform', async () => {
    const { svc, from } = make({ data: null, error: null });
    const res = await svc.resolveUpdate({ ...baseBody, platform: 'windows' });
    expect(from).not.toHaveBeenCalled();
    expect(res).toMatchObject({ error: 'no_new_version_available' });
  });

  it('returns no-update (never throws) on a query error', async () => {
    const { svc } = make({ data: null, error: { message: 'boom' } });
    const res = await svc.resolveUpdate(baseBody);
    expect(res).toMatchObject({ error: 'no_new_version_available' });
  });
});

describe('MobileUpdatesService.resolveRequirement', () => {
  const row = {
    min_supported_build: 1000,
    latest_build: 2000,
    latest_version: '2.0.0',
    store_url:
      'https://play.google.com/store/apps/details?id=tech.proyekto.app',
    message: null,
  };

  const ok = {
    status: 'ok',
    latestVersion: null,
    latestBuild: null,
    storeUrl: null,
    message: null,
  };

  it('blocks a shell below min_supported_build', async () => {
    const { svc } = make({ data: row, error: null });
    const res = await svc.resolveRequirement({
      platform: 'android',
      build: '999',
    });
    expect(res.status).toBe('required');
    expect(res.storeUrl).toBe(row.store_url);
    expect(res.latestVersion).toBe('2.0.0');
  });

  it('nudges a shell between min_supported_build and latest_build', async () => {
    const { svc } = make({ data: row, error: null });
    await expect(
      svc.resolveRequirement({ platform: 'android', build: '1500' }),
    ).resolves.toMatchObject({ status: 'optional' });
  });

  it('is quiet on the boundary and above it', async () => {
    const { svc } = make({ data: row, error: null });
    // Exactly min_supported_build is supported, not blocked.
    await expect(
      svc.resolveRequirement({ platform: 'android', build: '1000' }),
    ).resolves.toMatchObject({ status: 'optional' });
    await expect(
      svc.resolveRequirement({ platform: 'android', build: '2000' }),
    ).resolves.toMatchObject({ status: 'ok' });
    // A shell newer than the newest release is still fine.
    await expect(
      svc.resolveRequirement({ platform: 'android', build: '2500' }),
    ).resolves.toMatchObject({ status: 'ok' });
  });

  it('scopes the lookup to the platform and channel', async () => {
    const { svc, builder, from } = make({ data: row, error: null });
    await svc.resolveRequirement({
      platform: 'ios',
      build: '10',
      channel: 'beta',
    });
    expect(from).toHaveBeenCalledWith('mobile_app_requirements');
    expect(builder.eq).toHaveBeenCalledWith('platform', 'ios');
    expect(builder.eq).toHaveBeenCalledWith('channel', 'beta');
  });

  it('defaults to the production channel', async () => {
    const { svc, builder } = make({ data: row, error: null });
    await svc.resolveRequirement({ platform: 'android', build: '10' });
    expect(builder.eq).toHaveBeenCalledWith('channel', 'production');
  });

  // Every one of these must fail OPEN. A blocking dialog is the worst thing
  // this endpoint can emit, so anything unexpected resolves to "ok".
  it('fails open on an unknown platform', async () => {
    const { svc } = make({ data: row, error: null });
    await expect(
      svc.resolveRequirement({ platform: 'web', build: '1' }),
    ).resolves.toEqual(ok);
  });

  it('fails open on an unparseable build', async () => {
    const { svc } = make({ data: row, error: null });
    await expect(
      svc.resolveRequirement({ platform: 'android', build: 'nonsense' }),
    ).resolves.toEqual(ok);
    await expect(
      svc.resolveRequirement({ platform: 'android' }),
    ).resolves.toEqual(ok);
  });

  it('fails open when no row is configured', async () => {
    const { svc } = make({ data: null, error: null });
    await expect(
      svc.resolveRequirement({ platform: 'android', build: '1' }),
    ).resolves.toEqual(ok);
  });

  it('fails open when the query errors', async () => {
    const { svc } = make({ data: null, error: { message: 'boom' } });
    await expect(
      svc.resolveRequirement({ platform: 'android', build: '1' }),
    ).resolves.toEqual(ok);
  });

  it('fails open when the row has no store URL to send anyone to', async () => {
    const { svc } = make({ data: { ...row, store_url: '' }, error: null });
    await expect(
      svc.resolveRequirement({ platform: 'android', build: '1' }),
    ).resolves.toEqual(ok);
  });
});
