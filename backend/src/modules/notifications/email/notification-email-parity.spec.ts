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

  it('never marks roadmap_mention_invite email_eligible', () => {
    // This type's notification is created AT signup, and its pre-signup email is
    // sent directly by the backend. Making it eligible would email the person
    // ten minutes after they signed up, about the mention they signed up for.
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      if (!sql.includes('roadmap_mention_invite')) continue;
      expect(sql).not.toMatch(
        /email_eligible\s*=\s*true[\s\S]{0,200}roadmap_mention_invite/i,
      );
    }
  });
});
