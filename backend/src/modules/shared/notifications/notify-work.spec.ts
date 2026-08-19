import { DEFAULT_NOTIFY_DEADLINE_MS, runNotifyWork } from './notify-work';

describe('runNotifyWork', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves as soon as the work wins, without waiting for the deadline', async () => {
    const settled = jest.fn();
    const promise = runNotifyWork(Promise.resolve('done')).then(settled);

    await Promise.resolve();
    await promise;

    expect(settled).toHaveBeenCalled();
    // Nothing left behind: a fast path must not hold a timer open, which on
    // Cloud Run would keep the instance from settling.
    expect(jest.getTimerCount()).toBe(0);
  });

  it('resolves at the deadline when the work hangs, rather than blocking the caller', async () => {
    let resolveWork: (() => void) | undefined;
    const hanging = new Promise<void>((resolve) => {
      resolveWork = resolve;
    });

    const settled = jest.fn();
    const promise = runNotifyWork(hanging).then(settled);

    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    jest.advanceTimersByTime(DEFAULT_NOTIFY_DEADLINE_MS);
    await promise;

    expect(settled).toHaveBeenCalled();
    resolveWork?.();
  });

  it('honours an explicit deadline over the default', async () => {
    const settled = jest.fn();
    const promise = runNotifyWork(new Promise<void>(() => {}), 500).then(
      settled,
    );

    jest.advanceTimersByTime(499);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    await promise;
    expect(settled).toHaveBeenCalled();
  });

  it('swallows a rejection instead of surfacing it to the caller', async () => {
    // The originating write is already committed by the time this runs, so a
    // failed notification must never become a failed request.
    await expect(
      runNotifyWork(Promise.reject(new Error('push provider down'))),
    ).resolves.toBeUndefined();

    expect(jest.getTimerCount()).toBe(0);
  });
});
