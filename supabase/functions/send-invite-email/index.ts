// @ts-expect-error
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface InviteEmailRequest {
  to: string;
  inviterName: string;
  projectName: string;
  inviteLink: string;
  invitedPosition?: string | null;
  inviteMessage?: string | null;
}

// Exchange Gmail refresh token for a short-lived access token
async function getGmailAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to refresh Gmail access token: ${err}`);
  }
  const json = await res.json();
  return json.access_token as string;
}

// Encode a raw RFC 2822 message to base64url (required by Gmail API)
function toBase64Url(str: string): string {
  // TextEncoder -> Uint8Array -> base64 -> base64url
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function buildRawEmail(
  from: string,
  to: string,
  subject: string,
  textBody: string,
  htmlBody: string,
): string {
  const boundary = `invite_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return [
    `From: ${sanitizeHeaderValue(from)}`,
    `To: ${sanitizeHeaderValue(to)}`,
    `Subject: ${sanitizeHeaderValue(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary=\"${boundary}\"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    textBody,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    htmlBody,
    "",
    `--${boundary}--`,
  ].join("\r\n");
}

function getInviteEmailHtml(
  inviterName: string,
  projectName: string,
  inviteLink: string,
  invitedPosition?: string | null,
  inviteMessage?: string | null,
): string {
  const safeInviterName = escapeHtml(inviterName.trim());
  const safeProjectName = escapeHtml(projectName.trim());
  const safeInviteLink = escapeHtml(inviteLink.trim());
  const normalizedPosition = invitedPosition?.trim() ?? "";
  const normalizedNote = inviteMessage?.trim() ?? "";
  const safePosition =
    normalizedPosition.length > 0 ? escapeHtml(normalizedPosition) : null;
  const safeNote = normalizedNote.length > 0 ? escapeHtml(normalizedNote) : null;
  const previewText = escapeHtml(
    `${inviterName} invited you to join ${projectName} on Proyekto.`,
  );
  const positionBlock = safePosition
    ? `
                      <p style="margin:14px 0 4px;color:#64748b;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Role</p>
                      <p style="margin:0;color:#0f172a;font-size:15px;line-height:1.4;font-weight:600;">${safePosition}</p>
    `
    : "";
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
    : "";

  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Project invitation</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${previewText}</div>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f1f5f9;padding:28px 12px;">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:26px 32px;background-color:#0f172a;">
                <p style="margin:0 0 10px;color:#93c5fd;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">Proyekto</p>
                <h1 style="margin:0 0 10px;color:#ffffff;font-size:28px;line-height:1.2;font-weight:700;">You are invited to collaborate</h1>
                <p style="margin:0;color:#cbd5e1;font-size:15px;line-height:1.6;">
                  <strong style="color:#ffffff;">${safeInviterName}</strong> invited you to join
                  <strong style="color:#ffffff;">${safeProjectName}</strong>.
                </p>
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
</html>
  `.trim();
}

function getInviteEmailText(
  inviterName: string,
  projectName: string,
  inviteLink: string,
  invitedPosition?: string | null,
  inviteMessage?: string | null,
): string {
  const normalizedPosition = invitedPosition?.trim() ?? "";
  const normalizedNote = inviteMessage?.trim() ?? "";
  const lines: string[] = [
    `${inviterName} invited you to collaborate on ${projectName} in Proyekto.`,
    "",
    "Open your invitation:",
    inviteLink,
    "",
    "Project:",
    projectName,
  ];
  if (normalizedPosition.length > 0) {
    lines.push(`Role: ${normalizedPosition}`);
  }
  if (normalizedNote.length > 0) {
    lines.push("", `Personal note: ${normalizedNote}`);
  }
  lines.push(
    "",
    "If you do not have an account yet, sign up first with this email address and your invitation will be waiting for you.",
    "If the button does not work, copy and paste the link above into your browser.",
    "",
    "You received this email because someone invited you to a project on Proyekto.",
  );
  return lines.join("\n");
}

// @ts-ignore
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      to,
      inviterName,
      projectName,
      inviteLink,
      invitedPosition,
      inviteMessage,
    }: InviteEmailRequest = await req.json();

    if (!to || !inviterName || !projectName || !inviteLink) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields: to, inviterName, projectName, inviteLink" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    // @ts-ignore
    const clientId = Deno.env.get("GMAIL_CLIENT_ID") ?? Deno.env.get("GOOGLE_CLIENT_ID");
    // @ts-ignore
    const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET") ?? Deno.env.get("GOOGLE_CLIENT_SECRET");
    // @ts-ignore
    const refreshToken = Deno.env.get("GMAIL_REFRESH_TOKEN") ?? Deno.env.get("GOOGLE_REFRESH_TOKEN");
    const fromEmail = "accounts@prodigitality.net";

    if (!clientId || !clientSecret || !refreshToken) {
      console.error("send-invite-email: Missing Gmail OAuth credentials");
      return new Response(
        JSON.stringify({ success: false, error: "Server email configuration error" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
      );
    }

    const accessToken = await getGmailAccessToken(clientId, clientSecret, refreshToken);

    const subject = `${inviterName} invited you to collaborate on ${projectName}`;
    const textBody = getInviteEmailText(
      inviterName,
      projectName,
      inviteLink,
      invitedPosition,
      inviteMessage,
    );
    const htmlBody = getInviteEmailHtml(
      inviterName,
      projectName,
      inviteLink,
      invitedPosition,
      inviteMessage,
    );
    const rawEmail = buildRawEmail(
      `Proyekto <${fromEmail}>`,
      to,
      subject,
      textBody,
      htmlBody,
    );

    const gmailRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: toBase64Url(rawEmail) }),
      },
    );

    if (!gmailRes.ok) {
      const errText = await gmailRes.text();
      console.error("Gmail API error:", gmailRes.status, errText);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to send email via Gmail API", details: errText }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
      );
    }

    const result = await gmailRes.json();
    return new Response(
      JSON.stringify({ success: true, messageId: result.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("send-invite-email unexpected error:", message);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
