/**
 * Where a project invitation is answered, in the web app.
 *
 * One constant because three separate places used to hardcode the string — the
 * invitation email, the in-app `project_invite_received` notification, and the
 * mention-invite signup redirect — and they have to agree. They were all
 * `/freelancer/invites`, which was wrong for everyone who is not a freelancer:
 * the page is persona-neutral (it lists project invites for clients and
 * consultants too, and its only guard is authentication), so the persona in the
 * URL was misleading rather than protective.
 *
 * `/freelancer/invites` still resolves — the web route is kept as a redirect,
 * because invitation emails carrying the old path are already in inboxes and
 * will keep being opened for months.
 */
export const INVITES_PATH = '/invites';
