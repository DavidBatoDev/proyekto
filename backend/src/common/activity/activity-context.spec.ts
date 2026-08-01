import { of, defer, lastValueFrom, firstValueFrom } from 'rxjs';
import {
  activityStorage,
  bufferActivity,
  createActivityBuffer,
  runWithActivityBuffer,
} from './activity-context';
import { ActivityFlushInterceptor } from '../interceptors/activity-flush.interceptor';

function entry(action: string) {
  return {
    id: `id-${action}`,
    projectId: 'proj-1',
    action,
    entityType: 'task',
  };
}

describe('activity context (AsyncLocalStorage)', () => {
  it('returns false outside a request so callers can fall back', () => {
    expect(bufferActivity(entry('task.created'))).toBe(false);
  });

  it('buffers within a request', () => {
    const { buffer } = runWithActivityBuffer(() => {
      bufferActivity(entry('task.created'));
      bufferActivity(entry('task.updated'));
    });
    expect(buffer.entries.map((e) => e.action)).toEqual([
      'task.created',
      'task.updated',
    ]);
  });

  it('survives awaits and nested async calls', async () => {
    const buffer = createActivityBuffer();
    await activityStorage.run(buffer, async () => {
      bufferActivity(entry('a'));
      await new Promise((r) => setTimeout(r, 5));
      bufferActivity(entry('b'));
      await (async () => {
        await new Promise((r) => setImmediate(r));
        bufferActivity(entry('c'));
      })();
    });
    expect(buffer.entries.map((e) => e.action)).toEqual(['a', 'b', 'c']);
  });

  it('counts overflow past the cap instead of dropping silently', () => {
    const { buffer } = runWithActivityBuffer(() => {
      for (let i = 0; i < 5; i++) bufferActivity(entry(`a${i}`));
    }, 3);
    expect(buffer.entries).toHaveLength(3);
    expect(buffer.dropped).toBe(2);
  });

  /**
   * THE REGRESSION LOCK.
   *
   * next.handle() is a COLD Observable — Nest subscribes only after every
   * intercept() has returned. So establishing the store inside the interceptor
   * via `activityStorage.run(store, () => next.handle())` leaves the route
   * handler (which runs on subscribe) OUTSIDE the context, and every event is
   * silently lost. That is why the store is opened by middleware in main.ts.
   *
   * This test proves the trap is real, so nobody "simplifies" the middleware
   * away later.
   */
  it('demonstrates why run() around a cold Observable loses the context', async () => {
    const buffer = createActivityBuffer();

    // `defer` is what makes this faithful to Nest: the store is read on
    // SUBSCRIBE, exactly like a real route handler. Reading it eagerly inside
    // handle() would model the wrong thing and the test would pass vacuously.
    const coldHandler = {
      handle: () => defer(() => of(activityStorage.getStore())),
    };

    // WRONG shape: run() has already returned by the time we subscribe, so the
    // handler sees no store. THIS is the trap.
    const wrong = activityStorage.run(buffer, () => coldHandler.handle());
    expect(await firstValueFrom(wrong)).toBeUndefined();

    // RIGHT shape: the context is open around the subscription itself, which
    // is what the Express middleware achieves for real requests.
    const right = await activityStorage.run(buffer, () =>
      firstValueFrom(coldHandler.handle()),
    );
    expect(right).toBe(buffer);
  });
});

describe('ActivityFlushInterceptor', () => {
  const ctx = {} as never;

  it('no-ops when there is no request buffer', async () => {
    const audit = { flush: jest.fn() };
    const interceptor = new ActivityFlushInterceptor(audit as never);
    const out = await lastValueFrom(
      interceptor.intercept(ctx, { handle: () => of('payload') }),
    );
    expect(out).toBe('payload');
    expect(audit.flush).not.toHaveBeenCalled();
  });

  it('flushes once on success and passes the payload through untouched', async () => {
    const audit = { flush: jest.fn().mockResolvedValue(undefined) };
    const interceptor = new ActivityFlushInterceptor(audit as never);
    const buffer = createActivityBuffer();

    const out = await activityStorage.run(buffer, () =>
      lastValueFrom(
        interceptor.intercept(ctx, {
          handle: () => {
            bufferActivity(entry('task.created'));
            return of('payload');
          },
        }),
      ),
    );

    expect(out).toBe('payload');
    expect(audit.flush).toHaveBeenCalledTimes(1);
    expect(audit.flush).toHaveBeenCalledWith(buffer);
  });

  it('still flushes when the handler throws, and rethrows the original error', async () => {
    const audit = { flush: jest.fn().mockResolvedValue(undefined) };
    const interceptor = new ActivityFlushInterceptor(audit as never);
    const buffer = createActivityBuffer();
    const boom = new Error('handler exploded');

    await expect(
      activityStorage.run(buffer, () =>
        lastValueFrom(
          interceptor.intercept(ctx, {
            // defer so the throw becomes an errored Observable on subscribe —
            // a synchronous throw out of handle() would escape before
            // catchError is even attached, which is not how Nest behaves.
            handle: () =>
              defer(() => {
                // A partially-applied batch records before it fails.
                bufferActivity(entry('task.created'));
                throw boom;
              }),
          }),
        ),
      ),
    ).rejects.toBe(boom);

    expect(audit.flush).toHaveBeenCalledTimes(1);
  });
});
