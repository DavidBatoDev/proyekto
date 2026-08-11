/**
 * Where a team invitation is answered, in the web app.
 *
 * Mirrors `projects/invites-path.ts`. One constant so the email and anything
 * else that links here cannot drift apart.
 *
 * `handle_profile_team_invites_reconciliation` hardcodes the same string when it
 * materialises the post-signup notification. That copy stays in SQL
 * deliberately: a shipped function body cannot import from TypeScript, and
 * rewriting a live migration to share a constant buys nothing. If this value
 * ever changes, grep the migrations too.
 */
export const TEAM_INVITES_PATH = '/teams/me/invites';
