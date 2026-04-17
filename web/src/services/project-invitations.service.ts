import { supabase } from "@/lib/supabase";

export type InvitationRoleType = "consultant" | "freelancer" | "client";
export type InvitationRequestStatus = "pending" | "approved" | "rejected";

export interface InvitationLink {
  id: string;
  project_id: string;
  token: string;
  role_type: InvitationRoleType;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
}

export interface InvitationLinkInfo {
  id: string;
  token: string;
  role_type: InvitationRoleType;
  project: {
    id: string;
    title: string;
    banner_url?: string | null;
    status: string;
    consultant_id: string | null;
    consultant?: {
      id: string;
      display_name?: string | null;
      avatar_url?: string | null;
    } | null;
  };
}

export interface InvitationRequest {
  id: string;
  project_id: string;
  role_requested: InvitationRoleType;
  status: InvitationRequestStatus;
  note: string | null;
  rejection_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
  requester?: {
    id: string;
    display_name?: string | null;
    avatar_url?: string | null;
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
}

const API = import.meta.env.VITE_API_URL;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Authentication required");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
  };
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { message?: string })?.message ||
        (err as { error?: { message?: string } })?.error?.message ||
        `Request failed (${response.status})`,
    );
  }
  const body = await response.json();
  return (body?.data ?? body) as T;
}

// ── Links ──────────────────────────────────────────────────────────────────

export async function getInvitationLinks(projectId: string): Promise<InvitationLink[]> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API}/api/projects/${projectId}/invitation-links`, { headers });
  return handleResponse<InvitationLink[]>(res);
}

export async function createInvitationLink(
  projectId: string,
  roleType: InvitationRoleType,
  expiresAt?: string,
): Promise<InvitationLink> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API}/api/projects/${projectId}/invitation-links`, {
    method: "POST",
    headers,
    body: JSON.stringify({ role_type: roleType, expires_at: expiresAt }),
  });
  return handleResponse<InvitationLink>(res);
}

export async function revokeInvitationLink(
  projectId: string,
  linkId: string,
): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(
    `${API}/api/projects/${projectId}/invitation-links/${linkId}`,
    { method: "DELETE", headers },
  );
  await handleResponse<unknown>(res);
}

// ── Public link info ────────────────────────────────────────────────────────

export async function getInvitationLinkInfo(token: string): Promise<InvitationLinkInfo> {
  const res = await fetch(`${API}/api/invitation-links/${token}`, {
    headers: { "Content-Type": "application/json" },
  });
  return handleResponse<InvitationLinkInfo>(res);
}

// ── Requests ────────────────────────────────────────────────────────────────

export async function submitInvitationRequest(
  token: string,
  note?: string,
): Promise<InvitationRequest> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API}/api/invitation-links/${token}/request`, {
    method: "POST",
    headers,
    body: JSON.stringify({ note }),
  });
  return handleResponse<InvitationRequest>(res);
}

export async function getInvitationRequests(
  projectId: string,
  status?: InvitationRequestStatus,
): Promise<InvitationRequest[]> {
  const headers = await getAuthHeaders();
  const params = status ? `?status=${status}` : "";
  const res = await fetch(
    `${API}/api/projects/${projectId}/invitation-requests${params}`,
    { headers },
  );
  return handleResponse<InvitationRequest[]>(res);
}

export async function reviewInvitationRequest(
  requestId: string,
  status: "approved" | "rejected",
  rejectionReason?: string,
): Promise<InvitationRequest> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API}/api/invitation-requests/${requestId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status, rejection_reason: rejectionReason }),
  });
  return handleResponse<InvitationRequest>(res);
}

export function buildInviteUrl(token: string): string {
  return `${window.location.origin}/invite/${token}`;
}

export const ROLE_META: Record<
  InvitationRoleType,
  { label: string; description: string; color: string; gradient: string }
> = {
  consultant: {
    label: "Co-Consultant",
    description: "Full roadmap access, can manage team and tasks.",
    color: "text-purple-700",
    gradient: "from-purple-50 to-purple-100 border-purple-200",
  },
  freelancer: {
    label: "Freelancer",
    description: "Join the team as a contributor with task-level access.",
    color: "text-blue-700",
    gradient: "from-blue-50 to-blue-100 border-blue-200",
  },
  client: {
    label: "Client (Owner Transfer)",
    description: "Transfer full project ownership to this person.",
    color: "text-emerald-700",
    gradient: "from-emerald-50 to-emerald-100 border-emerald-200",
  },
};
