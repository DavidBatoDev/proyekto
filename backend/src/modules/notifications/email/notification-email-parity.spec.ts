import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EMAILABLE_NOTIFICATION_TYPES } from './notification-email-registry';

/**
 * Whether a type emails is decided in two places that must agree:
 * `notification_types.email_eligible` in the database, and the registry in this
 * build. The database can only ever be a SUBSET — a type marked eligible with no
 * template renders nothing, and the failure is invisible until someone reports a
 * missing email.
 *
 * This test cannot read production, so it pins the other half: the migration
 * that introduces the flag must not turn any type on. Activation is a separate,
 * deliberate UPDATE, reviewed on its own.
 */
describe('notification email switch parity', () => {
  const migrationsDir = join(__dirname, '../../../../../supabase/migrations');

  it('ships every type dark — no migration sets email_eligible = true', () => {
    const migration = readFileSync(
      join(migrationsDir, '20260804090000_notification_email_outbox.sql'),
      'utf8',
    );

    expect(migration).toContain(
      'email_eligible boolean NOT NULL DEFAULT false',
    );
    // An UPDATE ... SET email_eligible = true here would activate on deploy,
    // defeating the whole point of landing dark.
    expect(migration).not.toMatch(/SET\s+email_eligible\s*=\s*true/i);
  });

  it('renders exactly the four mention types, DMs, and mention invites', () => {
    // Anything else showing up here means scope crept without a decision.
    expect([...EMAILABLE_NOTIFICATION_TYPES].sort()).toEqual([
      'chat_dm_received',
      'chat_mention',
      'epic_comment_mention',
      'feature_comment_mention',
      'roadmap_mention_invite',
      'task_comment_mention',
    ]);
  });

  it('keeps roadmap_mention_invite out of the enqueue trigger', () => {
    // This type's notification is created AT signup, and its pre-signup email is
    // sent directly by the backend. If the trigger also enqueued for it, someone
    // would receive the invite, sign up because of it, then get a second email
    // ten minutes later about the mention they had just acted on.
    //
    // This used to be guarded by asserting no migration ever set the type
    // email_eligible. That guard died with activation: the column is overloaded
    // — for this one type it is the FEATURE switch, read by
    // RoadmapMentionInviteService and getMyPermissions, so it has to be true.
    // The real invariant is the trigger's exclusion, so pin that instead.
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    // Latest-function-body rule: only the newest definition is live.
    const newest = files
      .filter((f) =>
        readFileSync(join(migrationsDir, f), 'utf8').includes(
          'FUNCTION public.enqueue_notification_email()',
        ),
      )
      .pop();

    expect(newest).toBeDefined();
    const sql = readFileSync(join(migrationsDir, newest as string), 'utf8');
    expect(sql).toMatch(
      /v_type\.name\s*=\s*'roadmap_mention_invite'[\s\S]{0,80}RETURN NEW/i,
    );
  });
});
