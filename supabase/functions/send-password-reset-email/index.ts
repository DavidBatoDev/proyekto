// @ts-expect-error
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ResetEmailRequest {
  email: string;
}

type EmailErrorCode =
  | "BAD_REQUEST"
  | "SERVER_CONFIG_ERROR"
  | "EMAIL_AUTH_INVALID"
  | "EMAIL_AUTH_REQUEST_FAILED"
  | "EMAIL_SEND_FAILED"
  | "EMAIL_INTERNAL";

class EmailFunctionError extends Error {
  code: EmailErrorCode;
  stage: string;
  httpStatus: number;
  details?: Record<string, unknown>;

  constructor(
    code: EmailErrorCode,
    message: string,
    stage: string,
    httpStatus: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EmailFunctionError";
    this.code = code;
    this.stage = stage;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Send email via Resend API
async function sendEmail(
  resendApiKey: string,
  fromEmail: string,
  to: string,
  subject: string,
  htmlBody: string,
) {
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        subject,
        html: htmlBody,
      }),
    });
  } catch (error) {
    throw new EmailFunctionError(
      "EMAIL_AUTH_REQUEST_FAILED",
      "Failed to reach Resend API",
      "send_resend_email",
      500,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    const parsed = safeJsonParse(errorText);
    const providerMessage =
      typeof parsed?.message === "string"
        ? parsed.message
        : typeof parsed?.error === "string"
          ? parsed.error
          : null;

    const normalizedProviderMessage = (providerMessage || "").toLowerCase();
    const isCredentialError =
      response.status === 401 ||
      normalizedProviderMessage.includes("api key") ||
      normalizedProviderMessage.includes("unauthorized") ||
      normalizedProviderMessage.includes("invalid token");

    if (isCredentialError) {
      throw new EmailFunctionError(
        "EMAIL_AUTH_INVALID",
        "Resend authorization failed while sending email",
        "send_resend_email",
        500,
        {
          status: response.status,
          providerMessage,
        },
      );
    }

    throw new EmailFunctionError(
      "EMAIL_SEND_FAILED",
      "Resend rejected email send request",
      "send_resend_email",
      500,
      {
        status: response.status,
        providerMessage,
      },
    );
  }

  return await response.json();
}

function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hashHex;
}

function randomSalt(length = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getResetEmailHtml(code: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Your Password</title>
      </head>
      <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f9fafb;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;padding:40px 20px;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
                <tr>
                  <td style="padding:40px 40px 30px;text-align:center;border-bottom:1px solid #f3f4f6;">
                    <h1 style="margin:0;color:#1f2937;font-size:24px;font-weight:600;">Reset Your Password</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:40px;">
                    <p style="margin:0 0 24px;color:#374151;font-size:16px;line-height:1.6;">
                      Use the verification code below to reset your password:
                    </p>
                    <div style="margin:32px 0;text-align:center;padding:24px;background-color:#f3f4f6;border-radius:8px;">
                      <p style="margin:0 0 12px;color:#6b7280;font-size:14px;text-transform:uppercase;letter-spacing:1px;">Your Verification Code</p>
                      <p style="margin:0;color:#1f2937;font-size:32px;font-weight:700;letter-spacing:4px;">${code}</p>
                    </div>
                    <p style="margin:24px 0;color:#6b7280;font-size:14px;line-height:1.6;">This code will expire in 10 minutes.</p>
                    <p style="margin:24px 0 0;color:#6b7280;font-size:14px;line-height:1.6;">If you didn't request a password reset, you can ignore this email.</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px 40px;border-top:1px solid #f3f4f6;text-align:center;">
                    <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Proyekto Services</p>
                    <p style="margin:0;color:#9ca3af;font-size:12px;">You are receiving this email because a password reset was requested.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

// @ts-ignore
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email }: ResetEmailRequest = await req.json();
    if (!email || typeof email !== "string") {
      throw new EmailFunctionError(
        "BAD_REQUEST",
        "Missing or invalid 'email'",
        "validate_request",
        400,
      );
    }

    // Env
    // @ts-ignore
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    // @ts-ignore
    const resendFromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "Proyekto <onboarding@resend.dev>";
    // @ts-ignore
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    // @ts-ignore
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!resendApiKey) {
      throw new EmailFunctionError(
        "SERVER_CONFIG_ERROR",
        "Missing Resend credentials",
        "load_env",
        500,
      );
    }
    if (!supabaseUrl || !serviceRoleKey) {
      throw new EmailFunctionError(
        "SERVER_CONFIG_ERROR",
        "Missing Supabase service credentials",
        "load_env",
        500,
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const code = generateVerificationCode();
    const salt = randomSalt(16);
    const codeHash = await sha256Hex(`${salt}|${code}`);

    // Insert reset row
    const { error: insertError } = await supabase
      .from("password_resets")
      .insert({
        email,
        user_id: null,
        code_hash: codeHash,
        salt,
        // expires_at defaults to now()+10m
      });
    if (insertError) {
      throw new EmailFunctionError(
        "EMAIL_INTERNAL",
        "Failed to persist password reset code",
        "insert_password_reset",
        500,
        {
          dbCode: (insertError as { code?: string }).code ?? null,
          dbMessage: insertError.message,
        },
      );
    }

    // Send email
    const htmlBody = getResetEmailHtml(code);
    await sendEmail(
      resendApiKey,
      resendFromEmail,
      email,
      `Reset Your Password - Code: ${code}`,
      htmlBody,
    );

    return new Response(
      JSON.stringify({ success: true, message: "Password reset code sent" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    const handledError =
      error instanceof EmailFunctionError
        ? error
        : new EmailFunctionError(
            "EMAIL_INTERNAL",
            "Unexpected error in send-password-reset-email",
            "unknown",
            500,
            {
              cause: error instanceof Error ? error.message : String(error),
            },
          );

    console.error(
      "send-password-reset-email failed",
      JSON.stringify({
        code: handledError.code,
        stage: handledError.stage,
        message: handledError.message,
        details: handledError.details ?? null,
      }),
    );

    return new Response(
      JSON.stringify({
        success: false,
        error: handledError.message,
        errorCode: handledError.code,
        errorStage: handledError.stage,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: handledError.httpStatus,
      },
    );
  }
});


