/**
 * Render every outbound email to `backend/tmp/email-preview/` so the design can
 * be eyeballed in a browser without sending anything.
 *
 *   npx ts-node --transpile-only scripts/preview-emails.ts
 *
 * Kept in the repo because "does this actually look right" is otherwise only
 * answerable by mailing yourself, and that is a slow loop with real side
 * effects. Not wired into CI — the snapshot tests are the regression guard;
 * this is for looking.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml } from '../src/common/mail/templates/escape';
import {
  renderEmailLayout,
  renderParagraph,
} from '../src/common/mail/templates/layout';
import { buildInvoiceEmailHtml } from '../src/modules/marketplace/invoices/invoice-email.template';
import { renderNotificationEmail } from '../src/modules/shared/notifications/email/notification-email-registry';
import { buildInviteEmail } from '../src/modules/execution/projects/project-invite-email.template';
import { buildTeamInviteEmail } from '../src/modules/execution/teams/team-invite-email.template';

const OUT = join(__dirname, '..', 'tmp', 'email-preview');
mkdirSync(OUT, { recursive: true });

const APP = 'https://www.proyekto.tech';
const UNSUB = `${APP}/unsubscribe?token=demo`;

function write(name: string, html: string) {
  writeFileSync(join(OUT, `${name}.html`), html, 'utf8');
  console.log(`  ${name}.html`);
}

console.log('notification emails:');
for (const type of [
  'epic_comment_mention',
  'chat_dm_received',
  'roadmap_mention_invite',
]) {
  const rendered = renderNotificationEmail(type, {
    content: {
      actor_name: 'David Bato-bato',
      context_title: 'Checkout rebuild',
      excerpt:
        type === 'roadmap_mention_invite'
          ? undefined
          : 'Can you take a look at the payment step before Friday? I think the retry logic is off.',
    } as Record<string, unknown>,
    linkUrl: '/project/1/roadmap/2',
    appUrl: APP,
    unsubscribeUrl: UNSUB,
    recipientName: 'Jasmin Fedilo',
  });
  if (rendered) write(type, rendered.html);
}

console.log('transactional emails:');
write(
  'project-invite',
  buildInviteEmail({
    inviterName: 'David Bato-bato',
    projectName: 'Checkout rebuild',
    inviteLink: `${APP}/invites?inviteId=6f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d`,
    invitedPosition: 'Senior Frontend Engineer',
    inviteMessage: 'Would love your help on the payment step.',
  }).html,
);

write(
  'team-invite',
  buildTeamInviteEmail({
    inviterName: 'David Bato-bato',
    teamName: 'Prodigitality',
    inviteLink: `${APP}/teams/me/invites?inviteId=6f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d`,
    role: 'admin',
    position: 'Senior Frontend Engineer',
    inviteMessage: 'Would love to have you on the team.',
  }).html,
);

write(
  'invoice',
  buildInvoiceEmailHtml({
    invoice: {
      number: 'INV-2026-0042',
      total: 4200.5,
      currency: 'USD',
      due_date: '2026-09-01',
      period_start: '2026-08-01',
      period_end: '2026-08-31',
      payment_method: 'Bank transfer — details on the invoice.',
      issued_by: { name: 'Acme Studio' },
    } as never,
    link: `${APP}/invoices/inv-1`,
    hasAttachment: true,
  }),
);

// The OTP and contract bodies are built inline in their services; these mirror
// the same layout calls so the preview covers the whole set.
write(
  'otp-verify',
  renderEmailLayout({
    preheader: 'Your Proyekto verification code is 481920.',
    title: 'Verify your email',
    greeting: 'Hi Jasmin,',
    bodyHtml: [
      renderParagraph('Use this 6-digit code to verify your Proyekto account:'),
      `            <p style="margin:0 0 16px;color:#0f172a;font-size:32px;font-weight:700;letter-spacing:6px;line-height:1.3;">481920</p>`,
      renderParagraph(
        'This code expires in 10 minutes. If you did not create a Proyekto account, you can ignore this email.',
      ),
    ].join('\n'),
    footerNote:
      'You received this email because someone used this address to sign up for Proyekto.',
  }),
);

write(
  'contract-signing-link',
  renderEmailLayout({
    preheader: 'Acme Studio sent you a service agreement to review and sign.',
    title: 'A service agreement to sign',
    greeting: 'Hi Jasmin,',
    bodyHtml: [
      renderParagraph(
        `<strong>${escapeHtml('Acme Studio')}</strong> has sent you a service agreement to review and sign.`,
      ),
      renderParagraph('This link works once and expires on Fri Aug 14 2026.'),
    ].join('\n'),
    cta: { label: 'Open and sign the agreement', href: `${APP}/sign/abc` },
    footerNote:
      'You received this email because Acme Studio sent you a service agreement to sign on Proyekto.',
  }),
);

console.log(`\nwrote previews to ${OUT}`);
