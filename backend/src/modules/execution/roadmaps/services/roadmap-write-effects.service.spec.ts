import { RoadmapWriteEffects } from './roadmap-write-effects.service';
import type { RoadmapWriteContext } from './roadmap-authorization.service';

function createEffects() {
  const realtime = { publishRoadmapChange: jest.fn() };
  const activity = { record: jest.fn() };
  const cacheInvalidation = {
    invalidateAllDashboardCache: jest.fn().mockResolvedValue(undefined),
  };
  const effects = new RoadmapWriteEffects(
    realtime as never,
    activity as never,
    cacheInvalidation as never,
  );
  return { effects, realtime, activity, cacheInvalidation };
}

const ctx = { roadmapId: 'roadmap-1' } as RoadmapWriteContext;

describe('RoadmapWriteEffects dashboard cache bust', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('touch busts the dashboard cache — cards embed roadmap_summary', () => {
    const { effects, realtime, cacheInvalidation } = createEffects();

    effects.touch(ctx, 'user-1');

    expect(realtime.publishRoadmapChange).toHaveBeenCalledWith(
      'roadmap-1',
      'user-1',
    );
    expect(cacheInvalidation.invalidateAllDashboardCache).toHaveBeenCalledTimes(
      1,
    );
  });

  it('does not bust when the write has no roadmap scope', () => {
    const { effects, cacheInvalidation } = createEffects();

    effects.touch(null, 'user-1');

    expect(
      cacheInvalidation.invalidateAllDashboardCache,
    ).not.toHaveBeenCalled();
  });

  it('throttles bursts: one bust per window, another after it elapses', () => {
    jest.useFakeTimers({ now: 1_000_000 });
    const { effects, cacheInvalidation } = createEffects();

    effects.touch(ctx, 'user-1');
    effects.touch(ctx, 'user-1');
    effects.touch(ctx, 'user-1');
    expect(cacheInvalidation.invalidateAllDashboardCache).toHaveBeenCalledTimes(
      1,
    );

    jest.setSystemTime(1_000_000 + 2_500);
    effects.touch(ctx, 'user-1');
    expect(cacheInvalidation.invalidateAllDashboardCache).toHaveBeenCalledTimes(
      2,
    );
  });

  it('emit busts too (it routes through touch)', () => {
    const { effects, activity, cacheInvalidation } = createEffects();

    effects.emit(ctx, 'user-1', { action: 'updated' } as never);

    expect(activity.record).toHaveBeenCalled();
    expect(cacheInvalidation.invalidateAllDashboardCache).toHaveBeenCalledTimes(
      1,
    );
  });
});
