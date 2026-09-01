import { PRESENTATION_ONLY_CONTENT_KEYS } from '../notifications/notification-content';
import type { PushMessage } from './push.service';

/**
 * Human-readable push titles per notification `type_name`. The body comes from
 * `content.message`. Falls back to the brand name for unmapped types.
 *
 * Chat is the exception — see `buildChatHeadline`.
 */
const NOTIFICATION_TITLES: Record<string, string> = {
  marketplace_profile_live: 'Your profile is live',
  project_invite_received: 'Project invitation',
  project_invite_responded: 'Invitation update',
  milestone_completed: 'Milestone completed',
  chat_mention: 'New mention',
  chat_dm_received: 'New message',
  chat_message_received: 'New message',
  team_invite_received: 'Team invitation',
  project_team_invite_received: 'Project invitation for your team',
  project_team_invite_responded: 'Invitation update',
  task_assigned: 'Task assigned',
  task_comment_mention: 'You were mentioned',
  feature_comment_mention: 'You were mentioned',
  epic_comment_mention: 'You were mentioned',
  invoice_issued: 'New invoice',
  change_request_submitted: 'Change request needs a decision',
  change_request_decided: 'Change request decided',
  change_request_applied: 'Change request applied',
  time_log_approval_requested: 'Time log needs approval',
  time_log_marked_paid: 'Time log paid',
  time_log_marked_rejected: 'Time log rejected',
  time_log_day_rejected: 'Time logs rejected',
  time_log_comment_added: 'New time log comment',
  freelancer_invite_received: 'Talent invitation',
  consultant_application_submitted: 'Consultant application to review',
  consultant_application_approved: 'Consultant application approved',
  consultant_application_rejected: 'Consultant application decision',
  consultant_suspended: 'Consultant status update',
  consultant_reinstated: 'Consultant status update',
  consultant_revoked: 'Consultant status update',
};

const DEFAULT_TITLE = 'Proyekto';

/** Chat types get a sender-and-text headline instead of a type label. */
const CHAT_TYPE_NAMES: ReadonlySet<string> = new Set([
  'chat_mention',
  'chat_dm_received',
  'chat_message_received',
]);

export interface BuildPushInput {
  notificationId: string;
  typeName: string;
  content?: Record<string, unknown> | null;
  linkUrl?: string | null;
  projectId?: string | null;
}

export interface ChatHeadlineInput {
  actorName?: string | null;
  /** `#General` for a channel; absent for a DM. */
  roomLabel?: string | null;
  /** The message text, or an attachment stand-in like `📷 Photo`. */
  text?: string | null;
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

/**
 * Messenger-style headline: who it was from, and what they actually said.
 *
 * This REVERSES a previous deliberate choice to keep message text out of the
 * push body ("nothing should leak to a lock screen"). Lock screens are now
 * protected a layer down instead: chat pushes are routed to the `proyekto_chat`
 * Android channel, which is created with `visibility: Private`, so the text
 * shows in the notification shade but not on a locked device.
 *
 * The caveat that buys us is worth knowing: iOS previews are a per-app OS
 * setting the payload cannot force, so an iOS lock screen shows the text until
 * the user says otherwise.
 *
 * Notifications stack rather than replace (see PushMessage.threadKey), so each
 * message keeps its own tray row and the body never has to carry a count.
 */
export function buildChatHeadline(input: ChatHeadlineInput): {
  title: string;
  body: string;
} {
  const actor = str(input.actorName) ?? 'New message';
  const room = str(input.roomLabel);
  const text = str(input.text) ?? 'Sent a message';

  return {
    title: room ? `${actor} in ${room}` : actor,
    body: text,
  };
}

/**
 * Translate an in-app notification into an FCM push payload. The `data` map is
 * string->string (FCM requirement) and carries the type, ids, and a deep-link
 * (`link_url`, default `/notifications`) so a background/cold-start tap can route.
 *
 * Chat normally does NOT come through here — `ChatPushService` sends per message
 * and the chat call sites pass `skipPush`. The chat
 * branch below exists so that a chat notification created anywhere else still
 * reads correctly rather than falling back to "You were mentioned in a direct
 * message".
 */
export function buildPushMessage(input: BuildPushInput): PushMessage {
  const content = input.content ?? {};
  const isChat = CHAT_TYPE_NAMES.has(input.typeName);

  let title: string;
  let body: string;

  if (isChat && str(content.actor_name)) {
    const headline = buildChatHeadline({
      actorName: str(content.actor_name),
      roomLabel: str(content.room_label),
      text: str(content.excerpt),
    });
    title = headline.title;
    body = headline.body;
  } else {
    title = NOTIFICATION_TITLES[input.typeName] ?? DEFAULT_TITLE;
    body = str(content.message) ?? 'You have a new notification.';
  }

  const data: Record<string, string> = {
    notification_id: input.notificationId,
    type: input.typeName,
    link_url: input.linkUrl ?? '/notifications',
  };
  if (input.projectId) data.project_id = input.projectId;

  // Pass scalar ids from content (task_id, message_id, invoice_id, ...) through
  // so the app can act on the tap. Skip non-scalars and the presentation-only
  // keys: they exist to render a human-facing body, are not actionable on tap,
  // and `excerpt` in particular is long enough to waste the 4KB FCM budget.
  for (const [key, value] of Object.entries(content)) {
    if (PRESENTATION_ONLY_CONTENT_KEYS.has(key)) continue;
    if (typeof value === 'string' || typeof value === 'number') {
      data[key] = String(value);
    }
  }

  const roomId = str(content.room_id);
  return {
    title,
    body,
    data,
    // Group by conversation. Grouping, not collapsing — see PushMessage.threadKey.
    ...(isChat && roomId ? { threadKey: `chat:${roomId}` } : {}),
  };
}
