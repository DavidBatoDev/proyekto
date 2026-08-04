/**
 * The team-invitation email body.
 *
 * A sibling of `projects/project-invite-email.template.ts`, not a copy of it:
 * the chrome comes from `common/mail/templates/layout`, so the two cannot drift
 * apart the way the invite and invoice templates once did. Only the copy differs,
 * and it differs for a reason — joining a team is not the same act as
 * collaborating on one project, and the role carried here is team-level.
 *
 * Only the *content* lives here. `MailerService` owns headers, multipart
 * assembly and encoding.
 */

import { escapeHtml } from '../../common/mail/templates/escape';
import {
  renderDetailRows,
  renderEmailLayout,
  renderParagraph,
  renderQuoteBlock,
} from '../../common/mail/templates/layout';
import { renderTextEmail } from '../../common/mail/templates/text';

export interface TeamInviteEmailInput {
  inviterName: string;
  teamName: string;
  inviteLink: string;
  /** Team-level role. `member` is the default and not worth a line. */
  role?: string | null;
  /** Free-form job title, distinct from `role`. */
  position?: string | null;
  inviteMessage?: string | null;
}

export interface TeamInviteEmailBody {
  subject: string;
  html: string;
  text: string;
}

const FOOTER_NOTE =
  'You received this email because someone invited you to a team on Proyekto.';

/**
 * The reconciler is what makes this line true: signing up with this address
 * backfills `team_invites.invitee_id` and materialises the notification, so the
 * invitation really is waiting. Do not soften it without changing that trigger.
 */
const SIGNUP_NOTE =
  'If you do not have an account yet, sign up with this email address and your invitation will be waiting for you.';

export function buildTeamInviteEmail(
  input: TeamInviteEmailInput,
): TeamInviteEmailBody {
  const { inviterName, teamName, inviteLink, role, position, inviteMessage } =
    input;

  const trimmedInviter = inviterName.trim();
  const trimmedTeam = teamName.trim();
  const normalizedRole = role?.trim() ?? '';
  const normalizedPosition = position?.trim() ?? '';
  const normalizedNote = inviteMessage?.trim() ?? '';

  const rows = [{ label: 'Team', value: escapeHtml(trimmedTeam) }];
  // `member` is the default; a row saying so is noise.
  if (normalizedRole.length > 0 && normalizedRole !== 'member') {
    rows.push({ label: 'Role', value: escapeHtml(normalizedRole) });
  }
  if (normalizedPosition.length > 0) {
    rows.push({ label: 'Position', value: escapeHtml(normalizedPosition) });
  }

  const bodyHtml = [
    renderParagraph(
      `<strong>${escapeHtml(trimmedInviter)}</strong> invited you to join <strong>${escapeHtml(trimmedTeam)}</strong> on Proyekto.`,
    ),
    renderDetailRows(rows),
    normalizedNote.length > 0 ? renderQuoteBlock(normalizedNote) : null,
    renderParagraph(SIGNUP_NOTE),
  ]
    .filter((block): block is string => block !== null)
    .join('\n');

  const textLines: string[] = [
    `${trimmedInviter} invited you to join ${trimmedTeam} on Proyekto.`,
    '',
    `Team: ${trimmedTeam}`,
  ];
  if (normalizedRole.length > 0 && normalizedRole !== 'member') {
    textLines.push(`Role: ${normalizedRole}`);
  }
  if (normalizedPosition.length > 0) {
    textLines.push(`Position: ${normalizedPosition}`);
  }
  if (normalizedNote.length > 0) {
    textLines.push('', `"${normalizedNote}"`);
  }
  textLines.push(
    '',
    SIGNUP_NOTE,
    '',
    `View your invitation: ${inviteLink.trim()}`,
    '',
    FOOTER_NOTE,
  );

  return {
    subject: `${trimmedInviter} invited you to join ${trimmedTeam}`,
    html: renderEmailLayout({
      preheader: `${trimmedInviter} invited you to join ${trimmedTeam} on Proyekto.`,
      title: 'You are invited to join a team',
      bodyHtml,
      cta: { label: 'View invitation', href: inviteLink.trim() },
      footerNote: FOOTER_NOTE,
    }),
    text: renderTextEmail(textLines),
  };
}
