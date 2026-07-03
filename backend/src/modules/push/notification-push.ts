import type { PushMessage } from './push.service';

/**
 * Human-readable push titles per notification `type_name`. The body always comes
 * from `content.message` (every notification call site sets it). Falls back to
 * the brand name for unmapped types.
 */
const NOTIFICATION_TITLES: Record<string, string> = {
  marketplace_profile_live: 'Your profile is live',
  project_invite_received: 'Project invitation',
  project_invite_responded: 'Invitation update',
  milestone_completed: 'Milestone completed',
  chat_mention: 'New mention',
  team_invite_received: 'Team invitation',
  task_assigned: 'Task assigned',
  task_comment_mention: 'You were mentioned',
  feature_comment_mention: 'You were mentioned',
  epic_comment_mention: 'You were mentioned',
  invoice_issued: 'New invoice',
  time_log_approval_requested: 'Time log needs approval',
  time_log_marked_paid: 'Time log paid',
  time_log_marked_rejected: 'Time log rejected',
  time_log_day_rejected: 'Time logs rejected',
  time_log_comment_added: 'New time log comment',
  freelancer_invite_received: 'Freelancer invitation',
};

const DEFAULT_TITLE = 'Proyekto';

export interface BuildPushInput {
  notificationId: string;
  typeName: string;
  content?: Record<string, unknown> | null;
  linkUrl?: string | null;
  projectId?: string | null;
}

/**
 * Translate an in-app notification into an FCM push payload. The `data` map is
 * string->string (FCM requirement) and carries the type, ids, and a deep-link
 * (`link_url`, default `/notifications`) so a background/cold-start tap can route.
 */
export function buildPushMessage(input: BuildPushInput): PushMessage {
  const content = input.content ?? {};
  const title = NOTIFICATION_TITLES[input.typeName] ?? DEFAULT_TITLE;
  const body =
    typeof content.message === 'string' && content.message.trim().length > 0
      ? content.message
      : 'You have a new notification.';

  const data: Record<string, string> = {
    notification_id: input.notificationId,
    type: input.typeName,
    link_url: input.linkUrl ?? '/notifications',
  };
  if (input.projectId) data.project_id = input.projectId;

  // Pass scalar ids from content (task_id, message_id, invoice_id, ...) through
  // so the app can act on the tap. Skip the long `message` and any non-scalars.
  for (const [key, value] of Object.entries(content)) {
    if (key === 'message') continue;
    if (typeof value === 'string' || typeof value === 'number') {
      data[key] = String(value);
    }
  }

  return { title, body, data };
}
