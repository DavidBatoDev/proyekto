import { Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Has this address asked us to stop emailing it?
 *
 * One implementation because there are three callers — the outbox dispatcher,
 * the mention-invite path, and the Team-page invite — and the same address
 * getting different answers from different code paths is the bug this replaces.
 * Two of them used to carry their own copy of the query; the third had no check
 * at all, so someone could one-click unsubscribe and still be sent a project
 * invitation by hand.
 *
 * `email_suppressions` stores addresses lowercased with one row per address, so
 * the normalisation here is not cosmetic — a mixed-case invitee would miss the
 * row entirely.
 *
 * FAILS OPEN, deliberately, and this is the one judgement call worth revisiting:
 * a lookup error means we send. Failing closed would let a transient database
 * blip silently mute every email Proyekto sends, which is the larger outage; a
 * suppression check that errors is rare and the same failure would usually take
 * the send down anyway. The error is logged rather than discarded — the old
 * inline copies destructured it away, so a permanently broken check would have
 * looked exactly like "nobody is suppressed".
 */
const logger = new Logger('EmailSuppression');

export async function isEmailSuppressed(
  db: SupabaseClient,
  email: string,
): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;

  const { data, error } = await db
    .from('email_suppressions')
    .select('email')
    .eq('email', normalized)
    .maybeSingle();

  if (error) {
    logger.warn(
      `suppression lookup failed for ${normalized}: ${error.message} — treating as not suppressed`,
    );
    return false;
  }

  return data !== null;
}
