/**
 * The "bring your team onto this project" invitation email.
 *
 * A sibling of `team-invite-email.template.ts`, not a copy: that one asks a
 * person to join a team, this one asks a team's owner to bring their whole
 * team onto someone else's project. The recipient is not being given a job —
 * they are being asked to commit their people, so the copy names the project,
 * who is asking, and what access those people will get, and it never implies
 * the decision has already been made.
 *
 * Chrome comes from `common/mail/templates/layout`, so this cannot drift from
 * the other invitation emails. Only the *content* lives here; `MailerService`
 * owns headers, multipart assembly and encoding.
 */

import { escapeHtml } from '../../../common/mail/templates/escape';
import {
  renderDetailRows,
  renderEmailLayout,
  renderParagraph,
  renderQuoteBlock,
} from '../../../common/mail/templates/layout';
import { renderTextEmail } from '../../../common/mail/templates/text';

export interface ProjectTeamInviteEmailInput {
  inviterName: string;
  projectName: string;
  inviteLink: string;
  /** What the inviter typed to say which team they meant. Often absent. */
  teamNameHint?: string | null;
  /** Project role the members brought in will hold. */
  memberRole?: string | null;
  /** Whether this team is being asked to become the project's primary team. */
  makePrimary?: boolean;
  inviteMessage?: string | null;
}

export interface ProjectTeamInviteEmailBody {
  subject: string;
  html: string;
  text: string;
}

const FOOTER_NOTE =
  'You received this email because someone invited one of your teams to a project on Proyekto.';

/**
 * True for the same reason it is on the team invite: the reconciler backfills
 * `project_team_invites.invitee_id` on signup and materialises the in-app
 * notification. Do not soften this line without changing that trigger.
 */
const SIGNUP_NOTE =
  'If you do not have an account yet, sign up with this email address and your invitation will be waiting for you.';

const CHOICE_NOTE =
  'Accepting lets you choose which of your teams to bring and which of its members join. Nobody on your team gets access until you do.';

const PRIMARY_NOTE =
  'You are being asked to make this the project’s primary team, which means its billing identity fills in contracts and its pay periods drive invoicing.';

export function buildProjectTeamInviteEmail(
  input: ProjectTeamInviteEmailInput,
): ProjectTeamInviteEmailBody {
  const {
    inviterName,
    projectName,
    inviteLink,
    teamNameHint,
    memberRole,
    makePrimary,
    inviteMessage,
  } = input;

  const trimmedInviter = inviterName.trim();
  const trimmedProject = projectName.trim();
  const normalizedHint = teamNameHint?.trim() ?? '';
  const normalizedRole = memberRole?.trim() ?? '';
  const normalizedNote = inviteMessage?.trim() ?? '';

  const rows = [{ label: 'Project', value: escapeHtml(trimmedProject) }];
  // Only shown when the inviter actually named a team — an empty "Team" row
  // reads as "we could not find your team", which is not what happened.
  if (normalizedHint.length > 0) {
    rows.push({ label: 'Team', value: escapeHtml(normalizedHint) });
  }
  if (normalizedRole.length > 0) {
    rows.push({
      label: 'Your members join as',
      value: escapeHtml(normalizedRole),
    });
  }

  const bodyHtml = [
    renderParagraph(
      `<strong>${escapeHtml(trimmedInviter)}</strong> invited your team to work on <strong>${escapeHtml(trimmedProject)}</strong> on Proyekto.`,
    ),
    renderDetailRows(rows),
    normalizedNote.length > 0 ? renderQuoteBlock(normalizedNote) : null,
    renderParagraph(CHOICE_NOTE),
    makePrimary === true ? renderParagraph(PRIMARY_NOTE) : null,
    renderParagraph(SIGNUP_NOTE),
  ]
    .filter((block): block is string => block !== null)
    .join('\n');

  const textLines: string[] = [
    `${trimmedInviter} invited your team to work on ${trimmedProject} on Proyekto.`,
    '',
    `Project: ${trimmedProject}`,
  ];
  if (normalizedHint.length > 0) {
    textLines.push(`Team: ${normalizedHint}`);
  }
  if (normalizedRole.length > 0) {
    textLines.push(`Your members join as: ${normalizedRole}`);
  }
  if (normalizedNote.length > 0) {
    textLines.push('', `"${normalizedNote}"`);
  }
  textLines.push('', CHOICE_NOTE);
  if (makePrimary === true) {
    textLines.push('', PRIMARY_NOTE);
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
    subject: `${trimmedInviter} invited your team to ${trimmedProject}`,
    html: renderEmailLayout({
      preheader: `${trimmedInviter} invited your team to work on ${trimmedProject} on Proyekto.`,
      title: 'Your team is invited to a project',
      bodyHtml,
      cta: { label: 'View invitation', href: inviteLink.trim() },
      footerNote: FOOTER_NOTE,
    }),
    text: renderTextEmail(textLines),
  };
}
