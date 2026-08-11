import { SupabaseClient } from '@supabase/supabase-js';
import { isEmailSuppressed } from './email-suppression';

/**
 * The suppression check is the last thing standing between an opt-out and an
 * email, and all three senders now share this one implementation — so its
 * edges are worth pinning rather than assuming.
 */
describe('isEmailSuppressed', () => {
  /** Records the filter it was given, so case handling can be asserted. */
  function dbReturning(
    result: { data: unknown; error: { message: string } | null },
    seen: { email?: string } = {},
  ) {
    return {
      from: () => ({
        select: () => ({
          eq: (_column: string, value: string) => {
            seen.email = value;
            return { maybeSingle: () => Promise.resolve(result) };
          },
        }),
      }),
    } as unknown as SupabaseClient;
  }

  it('is true when a suppression row exists', async () => {
    const db = dbReturning({ data: { email: 'a@b.test' }, error: null });

    await expect(isEmailSuppressed(db, 'a@b.test')).resolves.toBe(true);
  });

  it('is false when there is no row', async () => {
    const db = dbReturning({ data: null, error: null });

    await expect(isEmailSuppressed(db, 'a@b.test')).resolves.toBe(false);
  });

  it('lowercases and trims before looking up', async () => {
    // Not cosmetic: suppressions are stored lowercased, one row per address, so
    // a mixed-case invitee would miss the row and get mailed anyway.
    const seen: { email?: string } = {};
    const db = dbReturning({ data: null, error: null }, seen);

    await isEmailSuppressed(db, '  Ada.Lovelace@Example.TEST  ');

    expect(seen.email).toBe('ada.lovelace@example.test');
  });

  it('fails OPEN when the lookup errors', async () => {
    // Deliberate: failing closed would let one bad query mute every email
    // Proyekto sends. Documented in the module header — change both together.
    const db = dbReturning({
      data: null,
      error: { message: 'connection lost' },
    });

    await expect(isEmailSuppressed(db, 'a@b.test')).resolves.toBe(false);
  });

  it('treats an empty address as not suppressed, without querying', async () => {
    let queried = false;
    const db = {
      from: () => {
        queried = true;
        return { select: () => ({ eq: () => ({ maybeSingle: () => null }) }) };
      },
    } as unknown as SupabaseClient;

    await expect(isEmailSuppressed(db, '   ')).resolves.toBe(false);
    expect(queried).toBe(false);
  });
});
