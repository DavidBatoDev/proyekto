import { Logger } from '@nestjs/common';
import type { LoggingForResult } from './time.types';
import {
  ALIAS_HITS_TTL_SECONDS,
  aliasHitsDay,
  aliasHitsKey,
  bumpLoggingForEpoch,
  LF_EPOCH_KEY,
  LF_TTL_SECONDS,
  loggingForKey,
  resetTimeCacheWarnThrottle,
  TimeCacheService,
} from './time-cache';

/** In-memory stand-in for @upstash/redis: get/set/incr/pipeline (incr, incrby, expire). */
function fakeRedis() {
  const store = new Map<string, unknown>();
  const ttl = new Map<string, number>();
  const pipelines: Array<Array<[string, ...unknown[]]>> = [];
  const redis = {
    store,
    ttl,
    pipelines,
    get: jest.fn((key: string) =>
      Promise.resolve(store.has(key) ? store.get(key) : null),
    ),
    set: jest.fn((key: string, value: unknown, opts?: { ex?: number }) => {
      store.set(key, value);
      if (opts?.ex) ttl.set(key, opts.ex);
      return Promise.resolve('OK');
    }),
    incr: jest.fn((key: string) => {
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, next);
      return Promise.resolve(next);
    }),
    pipeline: jest.fn(() => {
      const ops: Array<[string, ...unknown[]]> = [];
      pipelines.push(ops);
      const p = {
        incr: (key: string) => (ops.push(['incr', key]), p),
        incrby: (key: string, n: number) => (ops.push(['incrby', key, n]), p),
        expire: (key: string, s: number) => (ops.push(['expire', key, s]), p),
        exec: jest.fn(() => {
          for (const [op, key, arg] of ops) {
            const k = key as string;
            if (op === 'incr') store.set(k, Number(store.get(k) ?? 0) + 1);
            if (op === 'incrby')
              store.set(k, Number(store.get(k) ?? 0) + Number(arg));
            if (op === 'expire') ttl.set(k, Number(arg));
          }
          return Promise.resolve(ops.map(() => 1));
        }),
      };
      return p;
    }),
  };
  return redis;
}

function failingRedis() {
  const fail = () => Promise.reject(new Error('upstash down'));
  return {
    get: jest.fn(fail),
    set: jest.fn(fail),
    incr: jest.fn(fail),
    pipeline: jest.fn(() => {
      const p = {
        incr: () => p,
        incrby: () => p,
        expire: () => p,
        exec: jest.fn(fail),
      };
      return p;
    }),
  };
}

const RESULT: LoggingForResult = {
  options: [
    {
      kind: 'team',
      id: 't1',
      label: 'Design team',
      sheet_scope: { kind: 'team', ref: 't1' },
      rate_source: 'none',
      workspace_tag: null,
      approver_hint: 'team',
    },
  ],
  selected: null,
  prefill: null,
  unavailable: [],
};

describe('time-cache', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    resetTimeCacheWarnThrottle();
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  it('builds the documented keys', () => {
    expect(loggingForKey('3', 'u1', 'p1')).toBe('time:lf:3:u1:p1');
    expect(aliasHitsKey('logs.me.running', '20261005')).toBe(
      'time:alias:hits:logs.me.running:20261005',
    );
    expect(aliasHitsDay(new Date('2026-10-05T23:59:59Z'))).toBe('20261005');
    expect(LF_EPOCH_KEY).toBe('time:lf:epoch');
    expect(LF_TTL_SECONDS).toBe(30);
    expect(ALIAS_HITS_TTL_SECONDS).toBe(3456000);
  });

  describe('null Redis', () => {
    const svc = new TimeCacheService(null);

    it('is a no-op everywhere', async () => {
      await expect(svc.getLoggingFor('u1', 'p1')).resolves.toBeNull();
      await expect(
        svc.setLoggingFor('u1', 'p1', RESULT),
      ).resolves.toBeUndefined();
      await expect(svc.bumpEpoch()).resolves.toBeUndefined();
      await expect(svc.incrAliasHit('logs.start')).resolves.toBeUndefined();
      await expect(
        svc.flushAliasHits([
          { routeId: 'logs.start', day: '20261005', count: 3 },
        ]),
      ).resolves.toBeUndefined();
      await expect(bumpLoggingForEpoch(null)).resolves.toBeUndefined();
    });
  });

  describe('the logging-for cache', () => {
    it('round-trips a result under the current epoch with a 30 s TTL', async () => {
      const redis = fakeRedis();
      const svc = new TimeCacheService(redis as never);
      await svc.setLoggingFor('u1', 'p1', RESULT);
      expect(redis.set).toHaveBeenCalledWith(
        'time:lf:0:u1:p1',
        JSON.stringify(RESULT),
        { ex: LF_TTL_SECONDS },
      );
      await expect(svc.getLoggingFor('u1', 'p1')).resolves.toEqual(RESULT);
    });

    it('decodes a value Upstash already deserialised', async () => {
      const redis = fakeRedis();
      redis.store.set('time:lf:0:u1:p1', RESULT);
      await expect(
        new TimeCacheService(redis as never).getLoggingFor('u1', 'p1'),
      ).resolves.toEqual(RESULT);
    });

    it('misses on an unknown key and on garbage', async () => {
      const redis = fakeRedis();
      const svc = new TimeCacheService(redis as never);
      await expect(svc.getLoggingFor('u1', 'p1')).resolves.toBeNull();
      redis.store.set('time:lf:0:u1:p1', '{not json');
      await expect(svc.getLoggingFor('u1', 'p1')).resolves.toBeNull();
    });

    it('an epoch bump changes the key, so old entries miss', async () => {
      const redis = fakeRedis();
      const svc = new TimeCacheService(redis as never);
      await svc.setLoggingFor('u1', 'p1', RESULT);
      await svc.bumpEpoch();
      expect(redis.incr).toHaveBeenCalledWith(LF_EPOCH_KEY);
      await expect(svc.getLoggingFor('u1', 'p1')).resolves.toBeNull();
      await svc.setLoggingFor('u1', 'p1', RESULT);
      expect(redis.set).toHaveBeenLastCalledWith(
        'time:lf:1:u1:p1',
        JSON.stringify(RESULT),
        { ex: LF_TTL_SECONDS },
      );
    });

    it('bumpLoggingForEpoch works without DI', async () => {
      const redis = fakeRedis();
      await bumpLoggingForEpoch(redis as never);
      await bumpLoggingForEpoch(redis as never);
      expect(redis.store.get(LF_EPOCH_KEY)).toBe(2);
    });
  });

  describe('alias hit counters', () => {
    it('incrAliasHit pipelines INCR + EXPIRE on the day key', async () => {
      const redis = fakeRedis();
      const svc = new TimeCacheService(redis as never);
      await svc.incrAliasHit(
        'logs.me.running',
        new Date('2026-10-05T12:00:00Z'),
      );
      const key = 'time:alias:hits:logs.me.running:20261005';
      expect(redis.pipelines).toEqual([
        [
          ['incr', key],
          ['expire', key, ALIAS_HITS_TTL_SECONDS],
        ],
      ]);
      expect(redis.store.get(key)).toBe(1);
    });

    it('flushAliasHits sends one pipeline of INCRBY + EXPIRE per key and skips zero counts', async () => {
      const redis = fakeRedis();
      const svc = new TimeCacheService(redis as never);
      await svc.flushAliasHits([
        { routeId: 'logs.me.running', day: '20261005', count: 40 },
        { routeId: 'logs.start', day: '20261005', count: 2 },
        { routeId: 'logs.stop', day: '20261005', count: 0 },
      ]);
      expect(redis.pipelines).toHaveLength(1);
      expect(redis.pipelines[0]).toEqual([
        ['incrby', 'time:alias:hits:logs.me.running:20261005', 40],
        [
          'expire',
          'time:alias:hits:logs.me.running:20261005',
          ALIAS_HITS_TTL_SECONDS,
        ],
        ['incrby', 'time:alias:hits:logs.start:20261005', 2],
        [
          'expire',
          'time:alias:hits:logs.start:20261005',
          ALIAS_HITS_TTL_SECONDS,
        ],
      ]);
      await svc.flushAliasHits([]);
      expect(redis.pipelines).toHaveLength(1);
    });
  });

  describe('Redis errors', () => {
    it('are swallowed by every method', async () => {
      const svc = new TimeCacheService(failingRedis() as never);
      await expect(svc.getLoggingFor('u1', 'p1')).resolves.toBeNull();
      await expect(
        svc.setLoggingFor('u1', 'p1', RESULT),
      ).resolves.toBeUndefined();
      await expect(svc.bumpEpoch()).resolves.toBeUndefined();
      await expect(svc.incrAliasHit('logs.start')).resolves.toBeUndefined();
      await expect(
        svc.flushAliasHits([
          { routeId: 'logs.start', day: '20261005', count: 1 },
        ]),
      ).resolves.toBeUndefined();
      await expect(
        bumpLoggingForEpoch(failingRedis() as never),
      ).resolves.toBeUndefined();
    });

    it('are logged at warn at most once per minute', async () => {
      const svc = new TimeCacheService(failingRedis() as never);
      await svc.getLoggingFor('u1', 'p1');
      await svc.incrAliasHit('logs.start');
      await svc.bumpEpoch();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('upstash down');
    });
  });
});
