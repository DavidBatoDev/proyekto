import { escapeHtml } from '../../../../common/mail/templates/escape';
import {
  renderEmailLayout,
  renderParagraph,
  renderQuoteBlock,
} from '../../../../common/mail/templates/layout';
import { renderTextEmail } from '../../../../common/mail/templates/text';

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
 * `'Hi David,'` from whatever the profile holds, or nothing.
 *
 * First name only — a greeting that reads "Hi David Bato-bato," is worse than
 * no greeting. Returns null rather than falling back to "Hi there," because a
 * generic greeting adds a line without adding anything.
 */
function firstNameGreeting(recipientName: string | null): string | null {
  const first = (recipientName ?? '').trim().split(/\s+/)[0] ?? '';
  // Guard against a name column holding an address — "Hi jasmin@gmail.com,"
  // reads like a mail-merge failure.
  if (!first || first.length > 40 || first.includes('@')) return null;
  return `Hi ${first},`;
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
    /** The centred headline. */
    title: string;
    /**
     * Optional orienting line above the body, pre-escaped. Used when the reader
     * may never have heard of Proyekto.
     */
    introHtml?: string;
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
    copy.introHtml ? renderParagraph(copy.introHtml) : null,
    renderParagraph(lead),
    // Callers that must not disclose the source text pass no excerpt at all;
    // see the roadmap_mention_invite entry.
    excerpt ? renderQuoteBlock(excerpt) : null,
  ]
    .filter((block): block is string => block !== null)
    .join('\n');

  return {
    subject: copy.subjectFor(actor, contextTitle),
    html: renderEmailLayout({
      preheader: excerpt ?? `${actor} ${copy.action}`,
      title: copy.title,
      // The lead below already says who did what; the old layout repeated it in
      // a header band, which read as padding once the band was gone.
      greeting: firstNameGreeting(ctx.recipientName),
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

const VERDICT_FOOTER =
  'You received this email because you applied to become a consultant on Proyekto.';

const TIME_APPROVER_FOOTER =
  'You received this email because you approve time on Proyekto.';

const TIME_TRACKER_FOOTER =
  'You received this email because you track time on Proyekto.';

/**
 * Where a time email's button goes when the notification row carries no link
 * (D79): the timesheet named in the content, else the Time page. The producer
 * (TimeNotificationsService) always sets `link_url` from `timePath`, which
 * builds the same `/time/timesheets/<id>` and `/time` paths; `shared/` never
 * imports `execution/`, so the two literals are mirrored here.
 */
function timeFallbackLink(content: Record<string, unknown>): string {
  const sheetId = str(content, 'timesheet_id');
  return sheetId ? `/time/timesheets/${encodeURIComponent(sheetId)}` : '/time';
}

/**
 * The shared shape of the time emails: one sentence saying what happened and
 * one button back to the timesheet.
 *
 * The lead is `content.message`, the same sentence the bell and the push body
 * show, so the three surfaces cannot drift apart. TimeNotificationsService
 * builds it and its spec asserts it never carries an amount or a currency
 * (CHANGE-19); nothing here adds a figure of its own. `fallbackLead` covers a
 * bare content blob, which must still read as a sentence.
 */
function buildTimeEmail(
  ctx: NotificationEmailContext,
  copy: {
    subject: string;
    title: string;
    fallbackLead: string;
    ctaLabel: string;
    footerNote: string;
  },
): RenderedEmail {
  const message = str(ctx.content, 'message');
  const lead = message ? ensureSentence(message) : copy.fallbackLead;
  const href = absolute(
    ctx.appUrl,
    ctx.linkUrl ?? timeFallbackLink(ctx.content),
  );
  const greeting = firstNameGreeting(ctx.recipientName);

  return {
    subject: copy.subject,
    html: renderEmailLayout({
      preheader: lead,
      title: copy.title,
      greeting,
      bodyHtml: renderParagraph(escapeHtml(lead)),
      cta: { label: copy.ctaLabel, href },
      footerNote: copy.footerNote,
      unsubscribeHref: ctx.unsubscribeUrl,
    }),
    text: renderTextEmail([
      greeting,
      greeting ? '' : null,
      lead,
      '',
      `${copy.ctaLabel}: ${href}`,
      '',
      copy.footerNote,
    ]),
  };
}

/** Bell copy has no closing stop; an email sentence does. */
function ensureSentence(text: string): string {
  return /[.!?"”]$/.test(text) ? text : `${text}.`;
}

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

  /**
   * The only email in this registry sent to someone who has NO account.
   *
   * Two things are deliberately different, and both should survive review:
   *
   * 1. **No excerpt.** `buildMentionStyleEmail` quotes the source text when
   *    `content.excerpt` is present; the producer deliberately omits it here.
   *    Mailing 280 characters of a private project comment to an address that
   *    has proven nothing — and which may simply be a typo — is not a trade
   *    worth making for a slightly warmer email. The excerpt is kept on the
   *    pending row and shown in-app after they sign up and accept.
   * 2. **The CTA points at signup, not the comment.** `project_access.user_id`
   *    is NOT NULL, so there is nothing to grant them yet; a deep link would
   *    land on a login wall. `redirect=/invites` also lights up the
   *    existing "You've been invited" banner on the signup form for free.
   */
  roadmap_mention_invite: (ctx) =>
    buildMentionStyleEmail(ctx, {
      action: 'mentioned you in a comment',
      title: 'You were mentioned',
      introHtml:
        'Proyekto is where teams plan and deliver project work. Someone has invited you to join a project.',
      subjectFor: (actor, context) =>
        context
          ? `${actor} mentioned you in ${context}`
          : `${actor} mentioned you on Proyekto`,
      ctaLabel: 'Create your account',
      footerNote:
        'You received this email because someone invited you to a project on Proyekto. If it was not meant for you, unsubscribe below and we will not email you again.',
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

  // ── Consultant application verdicts ────────────────────────────────────────
  // Not mention-style: there is no actor to name (the platform is speaking)
  // and no excerpt to quote. A verdict is one clear sentence and one button.

  consultant_application_approved: (ctx) => {
    const href = absolute(ctx.appUrl, ctx.linkUrl);
    const bodyHtml = [
      renderParagraph(
        'Your consultant application was <strong>approved</strong>. You are now a verified consultant on Proyekto.',
      ),
      renderParagraph(
        'The consultant surfaces are open to you: browse the talent pool, respond to project briefs, publish templates, and build your service catalog. Your expertise placements are already live in the marketplace directory.',
      ),
    ].join('\n');
    return {
      subject: 'Your consultant application was approved',
      html: renderEmailLayout({
        preheader: 'You are now a verified consultant on Proyekto.',
        title: "You're verified",
        greeting: firstNameGreeting(ctx.recipientName) ?? undefined,
        bodyHtml,
        cta: { label: 'Open your profile', href },
        footerNote: VERDICT_FOOTER,
        unsubscribeHref: ctx.unsubscribeUrl ?? undefined,
      }),
      text: renderTextEmail([
        firstNameGreeting(ctx.recipientName),
        '',
        'Your consultant application was approved. You are now a verified consultant on Proyekto.',
        '',
        'The consultant surfaces are open to you: the talent pool, project briefs, templates, and your service catalog.',
        '',
        `Open your profile: ${href}`,
      ]),
    };
  },

  consultant_application_rejected: (ctx) => {
    const reason = str(ctx.content, 'reason');
    const href = absolute(ctx.appUrl, ctx.linkUrl);
    const bodyHtml = [
      renderParagraph(
        'Your consultant application was not approved this time.',
      ),
      reason ? renderQuoteBlock(reason) : null,
      renderParagraph(
        'You can revise your application and submit it again whenever you are ready — the reviewer’s note above is the place to start.',
      ),
    ]
      .filter((block): block is string => block !== null)
      .join('\n');
    return {
      subject: 'About your consultant application',
      html: renderEmailLayout({
        preheader:
          'Your application was not approved — you can revise and resubmit.',
        title: 'Application decision',
        greeting: firstNameGreeting(ctx.recipientName) ?? undefined,
        bodyHtml,
        cta: { label: 'Revise your application', href },
        footerNote: VERDICT_FOOTER,
        unsubscribeHref: ctx.unsubscribeUrl ?? undefined,
      }),
      text: renderTextEmail([
        firstNameGreeting(ctx.recipientName),
        '',
        'Your consultant application was not approved this time.',
        reason ? `Reviewer note: ${reason}` : null,
        '',
        'You can revise your application and submit it again whenever you are ready.',
        '',
        `Revise your application: ${href}`,
      ]),
    };
  },

  // ── Time ───────────────────────────────────────────────────────────────────
  // Activated by M1 (email_eligible = true). None of these names a figure:
  // no amount, no rate, no currency (CHANGE-19). Hours and dates may appear in
  // the lead, because they are part of `content.message`.

  timesheet_submitted: (ctx) => {
    const actor = str(ctx.content, 'actor_name');
    return buildTimeEmail(ctx, {
      subject: actor
        ? `${actor} sent a timesheet to review`
        : 'A timesheet is waiting for your review',
      title: 'Timesheet to review',
      fallbackLead: 'A timesheet was sent to you for review.',
      ctaLabel: 'Review timesheet',
      footerNote: TIME_APPROVER_FOOTER,
    });
  },

  timesheet_returned: (ctx) =>
    buildTimeEmail(ctx, {
      subject: 'Your timesheet was returned',
      title: 'Timesheet returned',
      fallbackLead:
        'Your timesheet was returned. Make the changes and send it again.',
      ctaLabel: 'Open timesheet',
      footerNote: TIME_TRACKER_FOOTER,
    }),

  timesheet_reminder: (ctx) =>
    buildTimeEmail(ctx, {
      subject: 'Time to submit your timesheet',
      title: 'Time to submit',
      fallbackLead: 'Your timesheet is ready to submit.',
      ctaLabel: 'Open timesheet',
      footerNote: TIME_TRACKER_FOOTER,
    }),

  time_payout_recorded: (ctx) =>
    buildTimeEmail(ctx, {
      subject: 'A payment was recorded for your time',
      title: 'Payment recorded',
      fallbackLead: 'A payment was recorded for your time.',
      ctaLabel: 'View your time',
      footerNote: TIME_TRACKER_FOOTER,
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
