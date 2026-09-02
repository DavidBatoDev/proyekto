/**
 * The workspace-invitation email body.
 *
 * A sibling of `teams/team-invite-email.template.ts`, not a copy of it: the
 * chrome comes from `common/mail/templates/layout`, so the two cannot drift
 * apart. Only the copy differs, and it differs for a reason — a workspace is the
 * organization someone is being brought into, which is a bigger thing than one
 * team inside it, and the role carried here is workspace-level.
 *
 * Only the *content* lives here. `MailerService` owns headers, multipart
 * assembly and encoding.
 */

import { escapeHtml } from '../../../common/mail/templates/escape';
import {
  renderDetailRows,
  renderEmailLayout,
  renderParagraph,
  renderQuoteBlock,
} from '../../../common/mail/templates/layout';
import { renderTextEmail } from '../../../common/mail/templates/text';

export interface WorkspaceInviteEmailInput {
  inviterName: string;
  workspaceName: string;
  inviteLink: string;
  /** Workspace-level role. `member` is the default and not worth a line. */
  role?: string | null;
  inviteMessage?: string | null;
}

export interface WorkspaceInviteEmailBody {
  subject: string;
  html: string;
  text: string;
}

const FOOTER_NOTE =
  'You received this email because someone invited you to a workspace on Proyekto.';

/**
 * The reconciler is what makes this line true: signing up with this address
 * backfills `workspace_invites.invitee_id` and materialises the notification, so
 * the invitation really is waiting. Do not soften it without changing that
 * trigger.
 */
const SIGNUP_NOTE =
  'If you do not have an account yet, sign up with this email address and your invitation will be waiting for you.';

export function buildWorkspaceInviteEmail(
  input: WorkspaceInviteEmailInput,
): WorkspaceInviteEmailBody {
  const { inviterName, workspaceName, inviteLink, role, inviteMessage } = input;

  const trimmedInviter = inviterName.trim();
  const trimmedWorkspace = workspaceName.trim();
  const normalizedRole = role?.trim() ?? '';
  const normalizedNote = inviteMessage?.trim() ?? '';

  const rows = [{ label: 'Workspace', value: escapeHtml(trimmedWorkspace) }];
  // `member` is the default; a row saying so is noise.
  if (normalizedRole.length > 0 && normalizedRole !== 'member') {
    rows.push({ label: 'Role', value: escapeHtml(normalizedRole) });
  }

  const bodyHtml = [
    renderParagraph(
      `<strong>${escapeHtml(trimmedInviter)}</strong> invited you to join the <strong>${escapeHtml(trimmedWorkspace)}</strong> workspace on Proyekto.`,
    ),
    renderDetailRows(rows),
    normalizedNote.length > 0 ? renderQuoteBlock(normalizedNote) : null,
    renderParagraph(SIGNUP_NOTE),
  ]
    .filter((block): block is string => block !== null)
    .join('\n');

  const textLines: string[] = [
    `${trimmedInviter} invited you to join the ${trimmedWorkspace} workspace on Proyekto.`,
    '',
    `Workspace: ${trimmedWorkspace}`,
  ];
  if (normalizedRole.length > 0 && normalizedRole !== 'member') {
    textLines.push(`Role: ${normalizedRole}`);
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
    subject: `${trimmedInviter} invited you to join ${trimmedWorkspace}`,
    html: renderEmailLayout({
      preheader: `${trimmedInviter} invited you to join ${trimmedWorkspace} on Proyekto.`,
      title: 'You are invited to join a workspace',
      bodyHtml,
      cta: { label: 'View invitation', href: inviteLink.trim() },
      footerNote: FOOTER_NOTE,
    }),
    text: renderTextEmail(textLines),
  };
}
