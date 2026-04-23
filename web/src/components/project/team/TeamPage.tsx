import { useState, useEffect, useCallback, useRef } from "react";
import {
  Search,
  ChevronDown,
  Plus,
  Trash2,
  MessageSquare,
  MoreHorizontal,
  Clock,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import type { Project, ProjectMember, ProjectInvite } from "@/services/project.service";
import { useUser } from "@/stores/authStore";
import { TeamSkeleton } from "./TeamSkeleton";
import { AddMemberModal } from "./AddMemberModal";
import { RemoveMemberModal } from "./RemoveMemberModal";
import { memberDisplayName } from "./utils";
import { toDmRef } from "@/components/project/chat/chatRef";
import {
  useProjectCancelInviteMutation,
  useProjectDetailQuery,
  useProjectInvitesQuery,
  useProjectMembersQuery,
  useProjectMyPermissionsQuery,
  useProjectRemoveMemberMutation,
} from "@/hooks/useProjectQueries";

// ─── Permission System ────────────────────────────────────────────────────────

type ViewerRole = "consultant" | "client" | "freelancer";
type TargetType = "client" | "consultant" | "member";

interface RowPermissions {
  canEdit: boolean;
  canRemove: boolean;
}

function deriveViewerRole(
  userId: string | undefined,
  project: Project | null,
  viewerMember?: ProjectMember | null,
): ViewerRole {
  if (!userId || !project) return "freelancer";
  if (userId === project.consultant_id) return "consultant";
  if (userId === project.client_id) return "client";
  const memberRole = viewerMember?.role;
  if (memberRole === "consultant") return "consultant";
  if (memberRole === "client") return "client";
  return "freelancer";
}

function getRowPermissions(
  viewerRole: ViewerRole,
  targetType: TargetType,
  isSelf: boolean,
  canManageMembers: boolean,
): RowPermissions {
  if (isSelf) return { canEdit: false, canRemove: false };
  const canManageTarget = canManageMembers && targetType === "member";

  switch (viewerRole) {
    case "consultant":
      if (targetType === "client") return { canEdit: false, canRemove: false };
      if (targetType === "consultant") return { canEdit: false, canRemove: false };
      return { canEdit: canManageTarget, canRemove: canManageTarget };
    case "client":
      if (targetType === "consultant") return { canEdit: false, canRemove: false };
      return { canEdit: canManageTarget, canRemove: canManageTarget };
    case "freelancer":
      if (targetType === "client") return { canEdit: false, canRemove: false };
      return { canEdit: canManageTarget, canRemove: canManageTarget };
  }
}

// ─── Role filter labels ───────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  consultant: "Consultant",
  client: "Client",
  member: "Freelancer",
};

const ROLE_COLORS: Record<string, string> = {
  consultant: "bg-violet-100 text-violet-700",
  client: "bg-blue-100 text-blue-700",
  member: "bg-emerald-100 text-emerald-700",
};

function inviteRole(invite: ProjectInvite): "consultant" | "client" | "member" {
  const pos = invite.invited_position ?? "";
  if (pos === "consultant") return "consultant";
  if (pos === "client") return "client";
  return "member";
}

function formatInviteDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface TeamPageProps {
  projectId: string;
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="w-8 h-8 rounded-full shrink-0 overflow-hidden flex items-center justify-center bg-slate-100 font-semibold text-slate-600 text-xs">
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className="w-full h-full object-cover object-top" />
      ) : (
        <span>{initials || "?"}</span>
      )}
    </div>
  );
}

// ─── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "Active" | "Offline" | "Away" }) {
  const config = {
    Active: { dot: "bg-emerald-400", text: "text-emerald-600" },
    Offline: { dot: "bg-slate-400", text: "text-slate-500" },
    Away: { dot: "bg-amber-400", text: "text-amber-600" },
  }[status];

  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${config.dot} shrink-0`} />
      <span className={`text-xs font-medium ${config.text}`}>{status}</span>
    </div>
  );
}

// ─── Column Headers ────────────────────────────────────────────────────────────

function ColumnHeaders({ showActions }: { showActions: boolean }) {
  return (
    <div
      className={`grid gap-4 items-center px-4 mb-2 ${
        showActions ? "grid-cols-[2fr_1fr_1fr_100px]" : "grid-cols-[2fr_1fr_1fr]"
      }`}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Name</span>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Role</span>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Status</span>
      {showActions && (
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 text-right">
          Actions
        </span>
      )}
    </div>
  );
}

// ─── More Dropdown (delete) ───────────────────────────────────────────────────

function MoreDropdown({
  onRemove,
  removing,
}: {
  onRemove: () => void;
  removing?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 transition-colors"
        title="More actions"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-48">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
            disabled={removing}
            className="w-full px-3 py-2 text-sm text-left text-red-600 hover:bg-red-50 flex items-center gap-2 disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remove from project
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Generic Team Row ─────────────────────────────────────────────────────────

function TeamRow({
  name,
  email,
  avatarUrl,
  roleLabel,
  isLast,
  isSelf,
  permissions,
  showActions,
  onRemove,
  onChat,
  removing,
}: {
  name: string;
  email?: string;
  avatarUrl?: string;
  roleLabel: string;
  isLast: boolean;
  isSelf: boolean;
  permissions: RowPermissions;
  showActions: boolean;
  onRemove?: () => void;
  onChat?: () => void;
  removing?: boolean;
}) {
  return (
    <div
      className={`grid gap-4 items-center px-4 py-3 ${
        showActions ? "grid-cols-[2fr_1fr_1fr_100px]" : "grid-cols-[2fr_1fr_1fr]"
      } ${!isLast ? "border-b border-slate-100" : ""} hover:bg-slate-50 transition-colors`}
    >
      {/* Col 1: Avatar + Name */}
      <div className="flex items-center gap-2.5 min-w-0">
        <Avatar name={name} avatarUrl={avatarUrl} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">{name}</p>
            {isSelf && (
              <span className="text-[10px] font-semibold text-slate-700 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded-full shrink-0">
                You
              </span>
            )}
          </div>
          {email && <p className="text-[11px] text-slate-500 truncate">{email}</p>}
        </div>
      </div>

      {/* Col 2: Role */}
      <span className="text-sm truncate text-slate-600">{roleLabel}</span>

      {/* Col 3: Status */}
      <StatusBadge status="Active" />

      {/* Col 4: Actions */}
      {showActions && (
        <div className="flex items-center justify-end gap-1">
          {onChat && (
            <button
              type="button"
              onClick={onChat}
              title="Send message"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-500 transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5" />
            </button>
          )}
          {permissions.canRemove && onRemove && (
            <MoreDropdown onRemove={onRemove} removing={removing} />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Execution Team Section ───────────────────────────────────────────────────

function MemberSection({
  title,
  members,
  roleLabel,
  viewerRole,
  canManageMembers,
  currentUserId,
  onRemove,
  removingId,
  showActions,
  projectId,
}: {
  title: string;
  members: ProjectMember[];
  roleLabel: string;
  viewerRole: ViewerRole;
  canManageMembers: boolean;
  currentUserId?: string;
  onRemove: (m: ProjectMember) => void;
  removingId: string | null;
  showActions: boolean;
  projectId: string;
}) {
  const navigate = useNavigate();
  if (members.length === 0) return null;

  return (
    <div className="app-surface-card p-4 md:p-5">
      <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-500">
        {title} ({members.length})
      </p>
      <ColumnHeaders showActions={showActions} />
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {members.map((m, idx) => {
          const isSelf = !!currentUserId && m.user_id === currentUserId;
          const perms = getRowPermissions(viewerRole, "member", isSelf, canManageMembers);
          const name = memberDisplayName(m);
          return (
            <TeamRow
              key={m.id}
              name={name}
              email={m.user?.email}
              avatarUrl={m.user?.avatar_url}
              roleLabel={m.position?.trim() || roleLabel}
              isLast={idx === members.length - 1}
              isSelf={isSelf}
              permissions={perms}
              showActions={showActions}
              onRemove={() => onRemove(m)}
              removing={removingId === m.id}
              onChat={
                !isSelf && m.user_id
                  ? () =>
                      void navigate({
                        to: "/project/$projectId/chat/$chatRef",
                        params: { projectId, chatRef: toDmRef(m.user_id!) },
                      })
                  : undefined
              }
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Role Filter Dropdown ─────────────────────────────────────────────────────

// ─── Pending Invites Section ──────────────────────────────────────────────────

function PendingInvitesSection({
  invites,
  canManage,
  onCancel,
  cancellingId,
}: {
  invites: ProjectInvite[];
  canManage: boolean;
  onCancel: (inviteId: string) => void;
  cancellingId: string | null;
}) {
  if (invites.length === 0) return null;

  return (
    <div className="app-surface-card p-4 md:p-5">
      <div className="mb-3 flex items-center gap-2">
        <Clock className="w-3.5 h-3.5 text-amber-500" />
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
          Pending Invites ({invites.length})
        </p>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
        {invites.map((inv) => {
          const role = inviteRole(inv);
          const roleLabel = ROLE_LABELS[role];
          const colorClass = ROLE_COLORS[role];
          const position =
            role === "member" && inv.invited_position
              ? inv.invited_position
              : null;
          const initials = (inv.invitee_email ?? "?")[0]?.toUpperCase() ?? "?";
          const inviterName = inv.inviter?.display_name ?? null;
          const cancelling = cancellingId === inv.id;

          return (
            <div
              key={inv.id}
              className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center bg-amber-100 text-amber-700 text-xs font-semibold">
                  {initials}
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {inv.invitee_email}
                    </p>
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                      <Clock className="w-2.5 h-2.5" />
                      Pending
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${colorClass}`}>
                      {roleLabel}
                    </span>
                    {position && (
                      <span className="text-[11px] text-slate-400">{position}</span>
                    )}
                    <span className="text-[11px] text-slate-400">
                      Invited {formatInviteDate(inv.created_at)}
                      {inviterName ? ` by ${inviterName}` : ""}
                    </span>
                  </div>
                </div>
              </div>

              {canManage && (
                <button
                  type="button"
                  onClick={() => onCancel(inv.id)}
                  disabled={cancelling}
                  title="Revoke invite"
                  className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 border border-slate-200 hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-40"
                >
                  {cancelling ? "Revoking…" : "Revoke"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type RoleFilter = "all" | "consultant" | "client" | "member";

function RoleFilterDropdown({
  value,
  onChange,
}: {
  value: RoleFilter;
  onChange: (v: RoleFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const label = value === "all" ? "All Roles" : ROLE_LABELS[value];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 transition-all hover:bg-slate-50 hover:border-slate-400"
      >
        {label}
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-40">
          {(["all", "consultant", "client", "member"] as RoleFilter[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                onChange(r);
                setOpen(false);
              }}
              className={`w-full px-3 py-2 text-sm text-left hover:bg-slate-50 transition-colors ${
                value === r ? "font-semibold text-slate-900" : "text-slate-600"
              }`}
            >
              {r === "all" ? "All Roles" : ROLE_LABELS[r]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function TeamPage({ projectId }: TeamPageProps) {
  const user = useUser();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  const projectQuery = useProjectDetailQuery(projectId);
  const membersQuery = useProjectMembersQuery(projectId);
  const invitesQuery = useProjectInvitesQuery(projectId);
  const myPermissionsQuery = useProjectMyPermissionsQuery(projectId);
  const removeMemberMutation = useProjectRemoveMemberMutation(projectId);
  const cancelInviteMutation = useProjectCancelInviteMutation(projectId);
  const [cancellingInviteId, setCancellingInviteId] = useState<string | null>(null);
  const project = (projectQuery.data as Project | undefined) ?? null;
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [removeCandidate, setRemoveCandidate] = useState<ProjectMember | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    const sourceMembers = membersQuery.data ?? [];
    const principalIds = new Set(
      [project?.client_id, project?.consultant_id].filter(Boolean),
    );
    const principalRoles = new Set(["client", "consultant"]);
    const filteredMembers = sourceMembers.filter(
      (member) =>
        (!member.user_id || !principalIds.has(member.user_id)) &&
        !principalRoles.has((member.role ?? "").toLowerCase()),
    );
    setMembers(filteredMembers);
  }, [membersQuery.data, project?.client_id, project?.consultant_id]);

  const handleRemove = useCallback((member: ProjectMember) => {
    setRemoveCandidate(member);
  }, []);

  const handleConfirmRemove = useCallback(async () => {
    if (!removeCandidate) return;
    setRemovingId(removeCandidate.id);
    try {
      await removeMemberMutation.mutateAsync(removeCandidate.id);
      setMembers((prev) => prev.filter((m) => m.id !== removeCandidate.id));
      setRemoveCandidate(null);
    } finally {
      setRemovingId(null);
    }
  }, [removeCandidate, removeMemberMutation]);

  const handleCloseRemoveModal = useCallback(() => {
    if (removingId) return;
    setRemoveCandidate(null);
  }, [removingId]);

  const handleCancelInvite = useCallback(async (inviteId: string) => {
    setCancellingInviteId(inviteId);
    try {
      await cancelInviteMutation.mutateAsync(inviteId);
    } finally {
      setCancellingInviteId(null);
    }
  }, [cancelInviteMutation]);

  const isLoading =
    projectQuery.isPending || membersQuery.isPending || myPermissionsQuery.isPending;
  const error =
    projectQuery.error instanceof Error
      ? projectQuery.error.message
      : membersQuery.error instanceof Error
        ? membersQuery.error.message
        : myPermissionsQuery.error instanceof Error
          ? myPermissionsQuery.error.message
          : null;

  if (isLoading) return <TeamSkeleton />;

  if (error) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="px-8 py-6">
          <div className="rounded-xl border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        </div>
      </div>
    );
  }

  const viewerMember = members?.find((m) => m.user_id === user?.id) ?? null;
  const viewerRole = deriveViewerRole(user?.id, project, viewerMember);
  const canManageMembers = Boolean(myPermissionsQuery.data?.members.manage);
  const canViewMembers = Boolean(
    myPermissionsQuery.data?.members.view || myPermissionsQuery.data?.members.manage,
  );
  const canAddMembers = canManageMembers;

  if (!canViewMembers) {
    return (
      <div className="app-shell-bg h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-5 py-6 md:px-8">
          <div className="app-surface-card rounded-2xl border-dashed p-8 text-center">
            <p className="text-sm font-semibold text-slate-900">
              You do not have permission to view team privileges.
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Ask a project lead to grant Members View permission.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const client = project?.client;
  const consultant = project?.consultant;

  const isSamePrincipal =
    !!client &&
    !!consultant &&
    ((client.id && consultant.id && client.id === consultant.id) ||
      (client.email &&
        consultant.email &&
        client.email.toLowerCase() === consultant.email.toLowerCase()));

  type Stakeholder = {
    id: string;
    name: string;
    avatarUrl?: string;
    email?: string;
    roleLabel: string;
    targetType: TargetType;
  };

  const stakeholders: Stakeholder[] = [];

  if (isSamePrincipal && client) {
    stakeholders.push({
      id: client.id,
      name: client.display_name || client.email || "Client",
      avatarUrl: client.avatar_url,
      email: client.email,
      roleLabel: "Client & Consultant",
      targetType: "consultant",
    });
  } else {
    if (client) {
      stakeholders.push({
        id: client.id,
        name: client.display_name || client.email || "Client",
        avatarUrl: client.avatar_url,
        email: client.email,
        roleLabel: "Client",
        targetType: "client",
      });
    }
    if (consultant) {
      stakeholders.push({
        id: consultant.id,
        name: consultant.display_name || consultant.email || "Consultant",
        avatarUrl: consultant.avatar_url,
        email: consultant.email,
        roleLabel: "Consultant",
        targetType: "consultant",
      });
    }
  }

  const q = search.toLowerCase();

  const filteredStakeholders = stakeholders.filter(
    (s) =>
      (roleFilter === "all" || s.targetType === roleFilter) &&
      (!q || s.name.toLowerCase().includes(q) || s.roleLabel.toLowerCase().includes(q)),
  );

  const filteredMembers = members.filter(
    (m) =>
      (roleFilter === "all" || roleFilter === "member") &&
      (!q ||
        memberDisplayName(m).toLowerCase().includes(q) ||
        (m.position ?? "").toLowerCase().includes(q)),
  );

  const allInvites = (invitesQuery.data as ProjectInvite[] | undefined) ?? [];
  const pendingInvites = allInvites.filter(
    (inv) =>
      inv.status === "pending" &&
      (roleFilter === "all" || inviteRole(inv) === roleFilter),
  );

  return (
    <div className="app-shell-bg h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-5 py-6 md:px-8">
        <div className="mb-6 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/85 p-1">
          <button
            type="button"
            className="px-4 py-1.5 rounded-full text-sm font-semibold transition-all bg-slate-900 text-white shadow-sm"
          >
            Team
          </button>
        </div>

        <div className="app-surface-card mb-8 mt-2 flex items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            <div className="app-input flex w-56 items-center gap-2 rounded-lg px-3 py-2 transition-all focus-within:ring-0">
              <Search className="w-3.5 h-3.5 shrink-0 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="bg-transparent text-sm text-slate-700 placeholder:text-slate-400 outline-none w-full"
              />
            </div>

            <RoleFilterDropdown value={roleFilter} onChange={setRoleFilter} />
          </div>

          {canAddMembers && (
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 app-cta rounded-md px-4 py-2 text-sm font-semibold text-white shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Add Team Member
            </button>
          )}
        </div>

        <div className="space-y-6">
          {filteredStakeholders.length > 0 && (
            <div className="app-surface-card p-4 md:p-5">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-500">
                Project Principals ({filteredStakeholders.length})
              </p>
              <ColumnHeaders showActions={canManageMembers} />
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                {filteredStakeholders.map((s, idx) => {
                  const isSelf = !!user?.id && s.id === user.id;
                  const perms = getRowPermissions(viewerRole, s.targetType, isSelf, canManageMembers);
                  return (
                    <TeamRow
                      key={s.id}
                      name={s.name}
                      avatarUrl={s.avatarUrl}
                      email={s.email}
                      roleLabel={s.roleLabel}
                      isLast={idx === filteredStakeholders.length - 1}
                      isSelf={isSelf}
                      permissions={perms}
                      showActions={canManageMembers}
                      onChat={
                        !isSelf && s.id
                          ? () =>
                              void navigate({
                                to: "/project/$projectId/chat/$chatRef",
                                params: { projectId, chatRef: toDmRef(s.id) },
                              })
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            </div>
          )}

          <MemberSection
            title="Team"
            members={filteredMembers}
            roleLabel="Member"
            viewerRole={viewerRole}
            canManageMembers={canManageMembers}
            currentUserId={user?.id}
            onRemove={handleRemove}
            removingId={removingId}
            showActions={canManageMembers}
            projectId={projectId}
          />

          <PendingInvitesSection
            invites={pendingInvites}
            canManage={canManageMembers}
            onCancel={(id) => void handleCancelInvite(id)}
            cancellingId={cancellingInviteId}
          />
        </div>
      </div>

      {showModal && (
        <AddMemberModal projectId={projectId} onClose={() => setShowModal(false)} />
      )}

      <RemoveMemberModal
        open={removeCandidate !== null}
        memberName={removeCandidate ? memberDisplayName(removeCandidate) : ""}
        loading={Boolean(
          removeCandidate && removingId && removingId === removeCandidate.id,
        )}
        onClose={handleCloseRemoveModal}
        onConfirm={() => void handleConfirmRemove()}
      />
    </div>
  );
}
