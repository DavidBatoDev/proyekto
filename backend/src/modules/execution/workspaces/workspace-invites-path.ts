/**
 * Where a workspace invitation is answered, in the web app.
 *
 * This is the shared received-invites inbox, which already answers team and
 * project invites — deliberately not a workspace-specific page. That page exists
 * precisely so a person holding several kinds of invite answers them in one
 * place instead of leaving half of them unanswered.
 *
 * `handle_profile_workspace_invites_reconciliation` hardcodes the same string
 * when it materialises the post-signup notification. That copy stays in SQL
 * deliberately: a shipped function body cannot import from TypeScript. If this
 * value ever changes, grep the migrations too.
 */
export const WORKSPACE_INVITES_PATH = '/teams/me/invites';
