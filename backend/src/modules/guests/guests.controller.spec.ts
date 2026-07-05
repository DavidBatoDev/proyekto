/* eslint-disable @typescript-eslint/unbound-method --
 * Handler references here are metadata lookup targets only; they are never
 * invoked, so `this` scoping is irrelevant. */
import { ThrottlerGuard } from '@nestjs/throttler';
import { GuestsController } from './guests.controller';

// Metadata keys: '__guards__' is @nestjs/common's GUARDS_METADATA; the
// throttler keys are THROTTLER_LIMIT/THROTTLER_TTL + the throttler name
// (see @nestjs/throttler's throttler.constants + throttler.decorator).
const GUARDS_METADATA = '__guards__';
const THROTTLER_LIMIT_DEFAULT = 'THROTTLER:LIMITdefault';
const THROTTLER_TTL_DEFAULT = 'THROTTLER:TTLdefault';

describe('GuestsController rate-limit wiring', () => {
  it('throttles create at 5 requests per minute', () => {
    const handler = GuestsController.prototype.createGuest;
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(
      ThrottlerGuard,
    );
    expect(Reflect.getMetadata(THROTTLER_LIMIT_DEFAULT, handler)).toBe(5);
    expect(Reflect.getMetadata(THROTTLER_TTL_DEFAULT, handler)).toBe(60_000);
  });

  it('throttles by-session at 30 requests per minute', () => {
    const handler = GuestsController.prototype.findBySession;
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(
      ThrottlerGuard,
    );
    expect(Reflect.getMetadata(THROTTLER_LIMIT_DEFAULT, handler)).toBe(30);
    expect(Reflect.getMetadata(THROTTLER_TTL_DEFAULT, handler)).toBe(60_000);
  });

  it('leaves pending and cleanup unthrottled', () => {
    for (const handler of [
      GuestsController.prototype.getPending,
      GuestsController.prototype.cleanup,
    ]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toBeUndefined();
      expect(
        Reflect.getMetadata(THROTTLER_LIMIT_DEFAULT, handler),
      ).toBeUndefined();
    }
  });

  it('no longer exposes the insecure migrate endpoint', () => {
    expect(
      (GuestsController.prototype as unknown as Record<string, unknown>)
        .migrateRoadmaps,
    ).toBeUndefined();
  });
});
