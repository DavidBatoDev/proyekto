const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const REQUEST_TIMEOUT_MS = 10_000;

type VerificationPurpose = "signup" | "login";

function getErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;

  const data = payload as {
    error?: { message?: unknown };
    message?: unknown;
  };

  if (typeof data.error?.message === "string" && data.error.message.trim()) {
    return data.error.message;
  }

  if (typeof data.message === "string" && data.message.trim()) {
    return data.message;
  }

  return fallback;
}

async function postJson<TResponse>(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<TResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(getErrorMessage(payload, "Request failed"));
    }

    const wrapped = payload as { data?: TResponse } | null;
    if (wrapped && "data" in wrapped) {
      return (wrapped.data ?? ({} as TResponse)) as TResponse;
    }
    return (payload ?? ({} as TResponse)) as TResponse;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function requestEmailVerificationCode(params: {
  email: string;
  firstName: string;
  lastName: string;
  purpose: VerificationPurpose;
}) {
  return postJson<{ success: boolean; message: string }>(
    "/api/auth/email-verification/request",
    params,
  );
}

export async function confirmEmailVerificationCode(params: {
  email: string;
  code: string;
}) {
  return postJson<{ success: boolean; message: string }>(
    "/api/auth/email-verification/confirm",
    params,
  );
}

export async function requestPasswordResetCode(params: { email: string }) {
  return postJson<{ success: boolean; message: string }>(
    "/api/auth/password-reset/request",
    params,
  );
}

export async function confirmPasswordResetCode(params: {
  email: string;
  code: string;
  newPassword: string;
}) {
  return postJson<{ success: boolean; message: string }>(
    "/api/auth/password-reset/confirm",
    params,
  );
}
