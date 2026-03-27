import { useState, useEffect, useCallback } from "react";
import {
  Search,
  ChevronDown,
  Plus,
  Edit2,
  Trash2,
  MessageSquare,
} from "lucide-react";
import type { Project, ProjectMember } from "@/services/project.service";
import { useUser } from "@/stores/authStore";
import { TeamSkeleton } from "./TeamSkeleton";
import { AddMemberModal } from "./AddMemberModal";
import { PermissionsDrawer } from "./PermissionsDrawer";
import { RemoveMemberModal } from "./RemoveMemberModal";
import { memberDisplayName } from "./utils";
import {
  useProjectDetailQuery,
  useProjectMembersQuery,
  useProjectMyPermissionsQuery,
  useProjectRemoveMemberMutation,
} from "@/hooks/useProjectQueries";

// ─── Permission System ────────────────────────────────────────────────────────

/**
 * The role of the currently logged-in viewer.
 * - consultant: has the consultant_id (even if also the client → treated as consultant)
 * - client:     has client_id but NOT consultant_id
 * - freelancer: any project member who isn't a principal
 */
type ViewerRole = "consultant" | "client" | "freelancer";

/**
 * The type of the row being rendered — used together with ViewerRole
 * to compute per-row permissions.
 */
type TargetType = "client" | "consultant" | "member";

interface RowPermissions {
  canMessage: boolean;
  canEdit: boolean;
  canRemove: boolean;
}

function deriveViewerRole(
  userId: string | undefined,
  project: Project | null,
): ViewerRole {
  if (!userId || !project) return "freelancer";
  // Edge-case: consultant === client → treat as consultant (full power)
  if (userId === project.consultant_id) return "consultant";
  if (userId === project.client_id) return "client";
  return "freelancer";
}

/**
 * Encodes the full interaction matrix from the spec.
 * isSelf always wins: no message, no edit, no remove for your own row.
 */
function getRowPermissions(
  viewerRole: ViewerRole,
  targetType: TargetType,
  isSelf: boolean,
  canManageMembers: boolean,
): RowPermissions {
  if (isSelf) return { canMessage: false, canEdit: false, canRemove: false };
  const canManageTarget = canManageMembers && targetType === "member";

  switch (viewerRole) {
    case "consultant":
      if (targetType === "client")
        return { canMessage: true, canEdit: false, canRemove: false };
      if (targetType === "consultant")
        return { canMessage: true, canEdit: false, canRemove: false };
      // member / freelancer
      return {
        canMessage: true,
        canEdit: canManageTarget,
        canRemove: canManageTarget,
      };

    case "client":
      if (targetType === "consultant")
        return { canMessage: true, canEdit: false, canRemove: false };
      // members and other clients: can see, but no message, no edit
      return {
        canMessage: false,
        canEdit: canManageTarget,
        canRemove: canManageTarget,
      };

    case "freelancer":
      if (targetType === "client")
        // Agency protection — hide the message button
        return { canMessage: false, canEdit: false, canRemove: false };
      // consultant or other members
      return {
        canMessage: true,
        canEdit: canManageTarget,
        canRemove: canManageTarget,
      };
  }
}


interface TeamPageProps {
  projectId: string;
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl?: string;
}) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="w-8 h-8 rounded-full shrink-0 overflow-hidden flex items-center justify-center bg-orange-100 font-semibold text-orange-500 text-xs">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={name}
          className="w-full h-full object-cover object-top"
        />
      ) : (
        <span>{initials || "?"}</span>
      )}
    </div>
  );
}

// ─── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "Active" | "Offline" | "Away" }) {
  const config = {
    Active: { dot: "bg-green-400", text: "text-green-600" },
    Offline: { dot: "bg-orange-400", text: "text-orange-500" },
    Away: { dot: "bg-yellow-400", text: "text-yellow-600" },
  }[status];

  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${config.dot} shrink-0`} />
      <span className={`text-xs font-medium ${config.text}`}>{status}</span>
    </div>
  );
}

// ─── Column Headers ────────────────────────────────────────────────────────────

function ColumnHeaders() {
  return (
    <div className="grid grid-cols-[2fr_1fr_1fr_48px_80px] gap-4 items-center px-4 mb-2">
      <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
        Name
      </span>
      <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
        Role
      </span>
      <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
        Status
      </span>
      <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide text-center">
        Msg
      </span>
      <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide text-right">
        Actions
      </span>
    </div>
  );
}

// ─── Generic Team Row ─────────────────────────────────────────────────────────
// Used for both principal rows and member rows.

function TeamRow({
  name,
  email,
  avatarUrl,
  roleLabel,
  isLast,
  isSelf,
  permissions,
  onEdit,
  onRemove,
  removing,
}: {
  name: string;
  email?: string;
  avatarUrl?: string;
  roleLabel: string;
  isLast: boolean;
  isSelf: boolean;
  permissions: RowPermissions;
  onEdit?: () => void;
  onRemove?: () => void;
  removing?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-[2fr_1fr_1fr_48px_80px] gap-4 items-center px-4 py-3 ${
        !isLast ? "border-b border-gray-100" : ""
      } hover:bg-gray-50/60 transition-colors`}
    >
      {/* Col 1: Avatar + Name */}
      <div className="flex items-center gap-2.5 min-w-0">
        <Avatar name={name} avatarUrl={avatarUrl} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">
              {name}
            </p>
            {isSelf && (
              <span className="text-[10px] font-semibold text-blue-500 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded-full shrink-0">
                You
              </span>
            )}
          </div>
          {email && (
            <p className="text-[11px] text-gray-400 truncate">{email}</p>
          )}
        </div>
      </div>

      {/* Col 2: Role */}
      <span className="text-sm text-gray-600 truncate">{roleLabel}</span>

      {/* Col 3: Status */}
      <StatusBadge status="Active" />

      {/* Col 4: Message — hidden if not permitted */}
      <div className="flex justify-center">
        {permissions.canMessage && (
          <button
            type="button"
            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
            title="Send message"
          >
            <MessageSquare className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Col 5: Edit / Remove — hidden if not permitted */}
      <div className="flex items-center justify-end gap-1">
        {permissions.canEdit && onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            title="Edit member"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
        )}
        {permissions.canRemove && onRemove && (
          <button
            type="button"
            onClick={onRemove}
            disabled={removing}
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-30"
            title="Remove member"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
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
  onEdit,
  onRemove,
  removingId,
}: {
  title: string;
  members: ProjectMember[];
  roleLabel: string;
  viewerRole: ViewerRole;
  canManageMembers: boolean;
  currentUserId?: string;
  onEdit: (m: ProjectMember) => void;
  onRemove: (m: ProjectMember) => void;
  removingId: string | null;
}) {
  if (members.length === 0) return null;

  return (
    <div>
      <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">
        {title} ({members.length})
      </p>
      <ColumnHeaders />
      <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
        {members.map((m, idx) => {
          const isSelf = !!currentUserId && m.user_id === currentUserId;
          const perms = getRowPermissions(
            viewerRole,
            "member",
            isSelf,
            canManageMembers,
          );
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
              onEdit={() => onEdit(m)}
              onRemove={() => onRemove(m)}
              removing={removingId === m.id}
            />
          );
        })}
      </div>
    </div>
  );
}


export function TeamPage({ projectId }: TeamPageProps) {
  const user = useUser();
  const [search, setSearch] = useState("");

  const projectQuery = useProjectDetailQuery(projectId);
  const membersQuery = useProjectMembersQuery(projectId);
  const myPermissionsQuery = useProjectMyPermissionsQuery(projectId);
  const removeMemberMutation = useProjectRemoveMemberMutation(projectId);
  const project = (projectQuery.data as Project | undefined) ?? null;
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [permissionMember, setPermissionMember] =
    useState<ProjectMember | null>(null);
  const [removeCandidate, setRemoveCandidate] = useState<ProjectMember | null>(
    null,
  );
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

  const handleUpdate = useCallback((updated: ProjectMember) => {
    setMembers((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  }, []);

  const handleRemove = useCallback(
    (member: ProjectMember) => {
      setRemoveCandidate(member);
    },
    [],
  );

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

  const isLoading =
    projectQuery.isPending ||
    membersQuery.isPending ||
    myPermissionsQuery.isPending;
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
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        </div>
      </div>
    );
  }

  const viewerRole = deriveViewerRole(user?.id, project);
  const canManageMembers = Boolean(myPermissionsQuery.data?.members.manage);
  const canViewMembers = Boolean(
    myPermissionsQuery.data?.members.view || myPermissionsQuery.data?.members.manage,
  );
  const canAddMembers = canManageMembers;

  if (!canViewMembers) {
    return (
      <div className="h-full overflow-y-auto bg-gray-50/40">
        <div className="px-6 py-6 w-full max-w-6xl">
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
            <p className="text-sm font-semibold text-gray-800">
              You do not have permission to view team privileges.
            </p>
            <p className="text-sm text-gray-500 mt-1">
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
    const isSelf = user?.id === client.id;
    stakeholders.push({
      id: client.id,
      name: client.display_name || client.email || "Client",
      avatarUrl: client.avatar_url,
      email: client.email,
      roleLabel: "Client & Consultant",
      targetType: "consultant",
    });
    void isSelf;
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
      !q ||
      s.name.toLowerCase().includes(q) ||
      s.roleLabel.toLowerCase().includes(q),
  );

  const filteredMembers = members.filter(
    (m) =>
      !q ||
      memberDisplayName(m).toLowerCase().includes(q) ||
      (m.position ?? "").toLowerCase().includes(q),
  );

  return (
    <div className="h-full overflow-y-auto bg-gray-50/40">
      <div className="px-6 py-6 w-full max-w-6xl">
        <div className="inline-flex items-center gap-1 bg-orange-50 border border-orange-100 rounded-full p-1 mb-6">
          <button
            type="button"
            className="px-4 py-1.5 rounded-full text-sm font-semibold transition-all bg-primary text-white shadow-sm"
          >
            Team
          </button>
        </div>

        <div className="flex items-center justify-between mt-2 mb-8 gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 w-56 focus-within:ring-2 focus-within:ring-orange-100 focus-within:border-orange-300 transition-all">
              <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="bg-transparent text-sm text-gray-700 placeholder:text-gray-400 outline-none w-full"
              />
            </div>

            <button
              type="button"
              className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 hover:border-gray-300 transition-all"
            >
              All Roles
              <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
            </button>
          </div>

          {canAddMembers && (
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-orange-400 hover:bg-orange-500 text-white text-sm font-semibold rounded-md shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Team Member
            </button>
          )}
        </div>

        <div className="space-y-8">
          {filteredStakeholders.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">
                Project Principals ({filteredStakeholders.length})
              </p>
              <ColumnHeaders />
              <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
                {filteredStakeholders.map((s, idx) => {
                  const isSelf = !!user?.id && s.id === user.id;
                  const perms = getRowPermissions(
                    viewerRole,
                    s.targetType,
                    isSelf,
                    canManageMembers,
                  );
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
            onEdit={setPermissionMember}
            onRemove={handleRemove}
            removingId={removingId}
          />
        </div>
      </div>

      {showModal && (
        <AddMemberModal projectId={projectId} onClose={() => setShowModal(false)} />
      )}

      <PermissionsDrawer
        open={permissionMember !== null}
        member={permissionMember}
        projectId={projectId}
        canEditPermissions={canManageMembers && viewerRole !== "client"}
        onMemberUpdated={handleUpdate}
        onClose={() => setPermissionMember(null)}
      />

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

