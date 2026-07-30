/**
 * The project-invitation email body.
 *
 * Extracted from `ProjectsService.buildInviteEmailRaw`, which used to assemble
 * the MIME message itself with its own Gmail plumbing. Only the *content* lives
 * here now — `MailerService` owns headers, multipart assembly and encoding, so
 * there is one implementation of those instead of three.
 *
 * Mirrors `modules/invoices/invoice-email.template.ts`.
 */

export interface InviteEmailInput {
  inviterName: string;
  projectName: string;
  inviteLink: string;
  invitedPosition?: string | null;
  inviteMessage?: string | null;
  inviterAvatarUrl?: string | null;
}

export interface InviteEmailBody {
  subject: string;
  html: string;
  text: string;
}

export function buildInviteEmail(input: InviteEmailInput): InviteEmailBody {
  const {
    inviterName,
    projectName,
    inviteLink,
    invitedPosition,
    inviteMessage,
    inviterAvatarUrl,
  } = input;

  const safeInviterName = escapeHtml(inviterName.trim());
  // Only embed http(s) avatars — never data: URIs or other schemes.
  const normalizedAvatar = (inviterAvatarUrl ?? '').trim();
  const safeAvatarUrl = /^https?:\/\//i.test(normalizedAvatar)
    ? escapeHtml(normalizedAvatar)
    : null;
  const inviterInitial = escapeHtml(
    (inviterName.trim().charAt(0) || 'P').toUpperCase(),
  );
  const avatarBlock = safeAvatarUrl
    ? `<img src="${safeAvatarUrl}" width="44" height="44" alt="" style="display:inline-block;width:44px;height:44px;border-radius:50%;border:2px solid rgba(255,255,255,0.25);object-fit:cover;vertical-align:middle;" />`
    : `<span style="display:inline-block;width:44px;height:44px;border-radius:50%;background-color:#2563eb;color:#ffffff;font-size:20px;font-weight:700;line-height:44px;text-align:center;vertical-align:middle;">${inviterInitial}</span>`;
  const safeProjectName = escapeHtml(projectName.trim());
  const safeInviteLink = escapeHtml(inviteLink.trim());
  const normalizedPosition = invitedPosition?.trim() ?? '';
  const normalizedNote = inviteMessage?.trim() ?? '';
  const safePosition =
    normalizedPosition.length > 0 ? escapeHtml(normalizedPosition) : null;
  const safeNote = normalizedNote.length > 0 ? escapeHtml(normalizedNote) : null;

  const subject = `${inviterName} invited you to collaborate on ${projectName}`;
  const previewText = `${inviterName} invited you to join ${projectName} on Proyekto.`;
  const safePreviewText = escapeHtml(previewText);
  const positionBlock = safePosition
    ? `
                      <p style="margin:14px 0 4px;color:#64748b;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Role</p>
                      <p style="margin:0;color:#0f172a;font-size:15px;line-height:1.4;font-weight:600;">${safePosition}</p>
      `
    : '';
  const noteBlock = safeNote
    ? `
                <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 22px;background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <p style="margin:0 0 6px;color:#1e3a8a;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Personal note</p>
                      <p style="margin:0;color:#1e293b;font-size:14px;line-height:1.6;">${safeNote}</p>
                    </td>
                  </tr>
                </table>
      `
    : '';

  const textLines: string[] = [
    `${inviterName} invited you to collaborate on ${projectName} in Proyekto.`,
    '',
    'Open your invitation:',
    inviteLink,
    '',
    'Project:',
    projectName,
  ];
  if (normalizedPosition.length > 0) {
    textLines.push(`Role: ${normalizedPosition}`);
  }
  if (normalizedNote.length > 0) {
    textLines.push('', `Personal note: ${normalizedNote}`);
  }
  textLines.push(
    '',
    'If you do not have an account yet, sign up first with this email address and your invitation will be waiting for you.',
    'If the button does not work, copy and paste the link above into your browser.',
    '',
    'You received this email because someone invited you to a project on Proyekto.',
  );

  const html = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Project invitation</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safePreviewText}</div>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f1f5f9;padding:28px 12px;">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:26px 32px;background-color:#0f172a;">
                <p style="margin:0 0 14px;color:#93c5fd;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">Proyekto</p>
                <h1 style="margin:0 0 16px;color:#ffffff;font-size:28px;line-height:1.2;font-weight:700;">You are invited to collaborate</h1>
                <table cellpadding="0" cellspacing="0" role="presentation"><tr>
                  <td style="padding-right:12px;vertical-align:middle;">${avatarBlock}</td>
                  <td style="vertical-align:middle;">
                    <p style="margin:0;color:#cbd5e1;font-size:15px;line-height:1.5;">
                      <strong style="color:#ffffff;">${safeInviterName}</strong> invited you to join<br />
                      <strong style="color:#ffffff;">${safeProjectName}</strong>.
                    </p>
                  </td>
                </tr></table>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 32px;">
                <p style="margin:0 0 18px;color:#334155;font-size:15px;line-height:1.6;">
                  Open your invitation to review the project and start collaborating.
                </p>
                <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 22px;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
                  <tr>
                    <td style="padding:16px 18px;">
                      <p style="margin:0 0 4px;color:#64748b;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Project</p>
                      <p style="margin:0;color:#0f172a;font-size:16px;line-height:1.5;font-weight:700;">${safeProjectName}</p>
                      ${positionBlock}
                    </td>
                  </tr>
                </table>
                ${noteBlock}
                <div style="margin:30px 0;text-align:center;">
                  <a href="${safeInviteLink}" style="display:inline-block;padding:14px 28px;background-color:#2563eb;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;">Open Invitation</a>
                </div>
                <p style="margin:0 0 12px;color:#475569;font-size:13px;line-height:1.6;">
                  If you do not have an account yet, sign up first with this email address and your invitation will be waiting for you.
                </p>
                <p style="margin:0 0 8px;color:#64748b;font-size:12px;line-height:1.5;">Button not working? Copy and paste this link:</p>
                <p style="margin:0;line-height:1.6;">
                  <a href="${safeInviteLink}" style="color:#1d4ed8;font-size:12px;text-decoration:underline;word-break:break-all;">${safeInviteLink}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 24px;background-color:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
                <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;">
                  You received this email because someone invited you to a project on Proyekto.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();

  return { subject, html, text: textLines.join('\n') };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
