/**
 * The shape of `notifications.content`, which is a free-form jsonb blob shared by
 * every producer (chat, roadmap comments, invoices, meetings, ...) and every
 * consumer (the bell, FCM push, and — from the email phase on — rendered mail).
 *
 * Producers add keys; consumers read them. Neither side owns the vocabulary, so
 * it lives here rather than in any one feature module.
 */

/**
 * How much source text to snapshot alongside a mention notification.
 *
 * Long enough to carry the gist into a push or email body, short enough that it
 * stays a teaser rather than a copy of the comment — someone who wants the whole
 * thread should follow the link.
 */
export const MENTION_EXCERPT_MAX_CHARS = 280;

/**
 * Keys that exist to render a human-facing body rather than to identify
 * something the app can navigate to.
 *
 * Consumers that build machine payloads (notably the FCM `data` map, which is
 * capped at 4KB) must skip these: they are prose, not addresses. `excerpt` in
 * particular is long enough to matter.
 */
export const PRESENTATION_ONLY_CONTENT_KEYS: ReadonlySet<string> = new Set([
  'message',
  'excerpt',
  'actor_name',
  'context_title',
  'room_label',
]);

/**
 * Human label for the chat room a notification came from — `#General` for a
 * channel, absent for a DM. Feeds the push title (`Ada in #General`).
 *
 * Deliberately NOT `context_title`, which the email renderer appends to its lead
 * as ` in <context_title>`. A DM's label is the literal string "a direct
 * message", so reusing that key would render "sent you a message in a direct
 * message" — see the comment on the DM producer in chat.service.ts.
 */
export const ROOM_LABEL_CONTENT_KEY = 'room_label';
