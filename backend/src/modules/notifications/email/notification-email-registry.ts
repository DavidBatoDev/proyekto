import { escapeHtml } from '../../../common/mail/templates/escape';
import {
  renderEmailLayout,
  renderParagraph,
  renderQuoteBlock,
} from '../../../common/mail/templates/layout';
import { renderTextEmail } from '../../../common/mail/templates/text';

/**
 * Which notification types become email, and what that email says.
 *
 * Mirrors `push/notification-push.ts`'s NOTIFICATION_TITLES: one table keyed by
 * `type_name`, so adding a type is a single entry rather than a new branch in
 * the worker.
 *
 * FAIL CLOSED — a type with no entry here produces no email, even if the
 * database says `email_eligible`. The two switches must agree, and a guard test
 * asserts they do; the alternative is shipping a blank or half-rendered message
 * to a real inbox.
 */

export interface NotificationEmailContext {
  /** `notifications.content`, as snapshotted into the outbox payload. */
  content: Record<string, unknown>;
  linkUrl: string | null;
  /** Absolute base for links, e.g. `https://www.proyekto.tech`. */
  appUrl: string;
  /** One-click unsubscribe URL, when the recipient has settings. */
  unsubscribeUrl: string | null;
  /** Recipient's display name, for the greeting. */
  recipientName: string | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

type Renderer = (ctx: NotificationEmailContext) => RenderedEmail;

/** Read a string out of the free-form content blob without trusting it. */
function str(content: Record<string, unknown>, key: string): string | null {
  const value = content[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * Absolute URL for an email. A relative `link_url` is useless in an inbox —
 * there is no origin to resolve it against.
 */
function absolute(appUrl: string, linkUrl: string | null): string {
  const base = appUrl.replace(/\/+$/, '');
  if (!linkUrl) return base;
  if (/^https?:\/\//i.test(linkUrl)) return linkUrl;
  return `${base}/${linkUrl.replace(/^\/+/, '')}`;
}

/**
 * The shared shape of every mention/message email: who did what, where, an
 * optional quote of what they said, and one button back into the app.
 */
function buildMentionStyleEmail(
  ctx: NotificationEmailContext,
  copy: {
    /** e.g. `'mentioned you in a comment'` — completes "<Actor> ...". */
    action: string;
    /** Heading inside the dark header band. */
    title: string;
    subjectFor: (actor: string, context: string | null) => string;
    ctaLabel: string;
    footerNote: string;
  },
): RenderedEmail {
  const actor = str(ctx.content, 'actor_name') ?? 'Someone';
  const contextTitle = str(ctx.content, 'context_title');
  const excerpt = str(ctx.content, 'excerpt');
  const href = absolute(ctx.appUrl, ctx.linkUrl);

  const where = contextTitle ? ` in ${escapeHtml(contextTitle)}` : '';
  const lead = `<strong>${escapeHtml(actor)}</strong> ${escapeHtml(copy.action)}${where}.`;

  const bodyHtml = [
    renderParagraph(lead),
    excerpt ? renderQuoteBlock(excerpt) : null,
  ]
    .filter((block): block is string => block !== null)
    .join('\n');

  return {
    subject: copy.subjectFor(actor, contextTitle),
    html: renderEmailLayout({
      preheader: excerpt ?? `${actor} ${copy.action}`,
      title: copy.title,
      subtitleHtml: `${escapeHtml(actor)} ${escapeHtml(copy.action)}${where}`,
      bodyHtml,
      cta: { label: copy.ctaLabel, href },
      footerNote: copy.footerNote,
      unsubscribeHref: ctx.unsubscribeUrl,
    }),
    text: renderTextEmail([
      `${actor} ${copy.action}${contextTitle ? ` in ${contextTitle}` : ''}.`,
      '',
      excerpt ? `"${excerpt}"` : null,
      excerpt ? '' : null,
      `${copy.ctaLabel}: ${href}`,
      '',
      copy.footerNote,
    ]),
  };
}

const MENTION_FOOTER =
  'You received this email because you were mentioned on Proyekto.';

/**
 * DMs need their own footer. Reusing MENTION_FOOTER would tell the reader they
 * were mentioned when they were not — sitting directly beside the unsubscribe
 * link, which is the one place the email has to be straight with them.
 */
const DM_FOOTER =
  'You received this email because you have an unread direct message on Proyekto.';

const REGISTRY: Record<string, Renderer> = {
  task_comment_mention: (ctx) =>
    buildMentionStyleEmail(ctx, {
      action: 'mentioned you in a task comment',
      title: 'You were mentioned',
      subjectFor: (actor, context) =>
        context
          ? `${actor} mentioned you in ${context}`
          : `${actor} mentioned you in a task comment`,
      ctaLabel: 'View comment',
      footerNote: MENTION_FOOTER,
    }),

  feature_comment_mention: (ctx) =>
    buildMentionStyleEmail(ctx, {
      action: 'mentioned you in a feature comment',
      title: 'You were mentioned',
      subjectFor: (actor, context) =>
        context
          ? `${actor} mentioned you in ${context}`
          : `${actor} mentioned you in a feature comment`,
      ctaLabel: 'View comment',
      footerNote: MENTION_FOOTER,
    }),

  epic_comment_mention: (ctx) =>
    buildMentionStyleEmail(ctx, {
      action: 'mentioned you in an epic comment',
      title: 'You were mentioned',
      subjectFor: (actor, context) =>
        context
          ? `${actor} mentioned you in ${context}`
          : `${actor} mentioned you in an epic comment`,
      ctaLabel: 'View comment',
      footerNote: MENTION_FOOTER,
    }),

  chat_mention: (ctx) =>
    buildMentionStyleEmail(ctx, {
      action: 'mentioned you',
      title: 'You were mentioned',
      subjectFor: (actor, context) =>
        context
          ? `${actor} mentioned you in ${context}`
          : `${actor} mentioned you in chat`,
      ctaLabel: 'Open chat',
      footerNote: MENTION_FOOTER,
    }),

  chat_dm_received: (ctx) =>
    buildMentionStyleEmail(ctx, {
      action: 'sent you a message',
      title: 'New direct message',
      // Ignores `context` deliberately — the DM producer sets no context_title,
      // because "sent you a message in a direct message" reads badly.
      subjectFor: (actor) => `${actor} sent you a message`,
      ctaLabel: 'Open conversation',
      footerNote: DM_FOOTER,
    }),
};

/** Every type this build can render. The database must not exceed this set. */
export const EMAILABLE_NOTIFICATION_TYPES: readonly string[] =
  Object.keys(REGISTRY);

export function canRenderNotificationEmail(typeName: string): boolean {
  return Object.hasOwn(REGISTRY, typeName);
}

/**
 * Render an email for a notification type, or null when this build has no
 * template for it — the caller must treat null as "skip", never as "send blank".
 */
export function renderNotificationEmail(
  typeName: string,
  ctx: NotificationEmailContext,
): RenderedEmail | null {
  const renderer = REGISTRY[typeName];
  return renderer ? renderer(ctx) : null;
}
