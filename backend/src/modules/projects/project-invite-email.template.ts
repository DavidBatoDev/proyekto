/**
 * The project-invitation email body.
 *
 * Only the *content* lives here — `MailerService` owns headers, multipart
 * assembly and encoding, and `common/mail/templates/layout` owns the chrome.
 * This file used to carry its own full copy of a near-identical layout; it
 * drifted from the others in spacing and heading sizes, which is why the layout
 * is now shared rather than mirrored.
 *
 * The inviter's avatar is deliberately gone. It only ever appeared inside the
 * old dark header band, and a floating circle above the headline was decoration
 * competing with the one thing the reader needs to do.
 */

import { escapeHtml } from '../../common/mail/templates/escape';
import {
  renderDetailRows,
  renderEmailLayout,
  renderParagraph,
  renderQuoteBlock,
} from '../../common/mail/templates/layout';
import { renderTextEmail } from '../../common/mail/templates/text';

export interface InviteEmailInput {
  inviterName: string;
  projectName: string;
  inviteLink: string;
  invitedPosition?: string | null;
  inviteMessage?: string | null;
}

export interface InviteEmailBody {
  subject: string;
  html: string;
  text: string;
}

const FOOTER_NOTE =
  'You received this email because someone invited you to a project on Proyekto.';

export function buildInviteEmail(input: InviteEmailInput): InviteEmailBody {
  const {
    inviterName,
    projectName,
    inviteLink,
    invitedPosition,
    inviteMessage,
  } = input;

  const trimmedInviter = inviterName.trim();
  const trimmedProject = projectName.trim();
  const normalizedPosition = invitedPosition?.trim() ?? '';
  const normalizedNote = inviteMessage?.trim() ?? '';

  const rows = [{ label: 'Project', value: escapeHtml(trimmedProject) }];
  if (normalizedPosition.length > 0) {
    rows.push({ label: 'Role', value: escapeHtml(normalizedPosition) });
  }

  const bodyHtml = [
    renderParagraph(
      `<strong>${escapeHtml(trimmedInviter)}</strong> invited you to collaborate on <strong>${escapeHtml(trimmedProject)}</strong> in Proyekto.`,
    ),
    renderDetailRows(rows),
    normalizedNote.length > 0 ? renderQuoteBlock(normalizedNote) : null,
    renderParagraph(
      'If you do not have an account yet, sign up with this email address and your invitation will be waiting for you.',
    ),
  ]
    .filter((block): block is string => block !== null)
    .join('\n');

  const textLines: string[] = [
    `${trimmedInviter} invited you to collaborate on ${trimmedProject} in Proyekto.`,
    '',
    `Project: ${trimmedProject}`,
  ];
  if (normalizedPosition.length > 0) {
    textLines.push(`Role: ${normalizedPosition}`);
  }
  if (normalizedNote.length > 0) {
    textLines.push('', `"${normalizedNote}"`);
  }
  textLines.push(
    '',
    'If you do not have an account yet, sign up with this email address and your invitation will be waiting for you.',
    '',
    `Open your invitation: ${inviteLink.trim()}`,
    '',
    FOOTER_NOTE,
  );

  return {
    subject: `${inviterName} invited you to collaborate on ${projectName}`,
    html: renderEmailLayout({
      preheader: `${trimmedInviter} invited you to join ${trimmedProject} on Proyekto.`,
      title: 'You are invited to collaborate',
      bodyHtml,
      cta: { label: 'Open invitation', href: inviteLink.trim() },
      footerNote: FOOTER_NOTE,
    }),
    text: renderTextEmail(textLines),
  };
}
