import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { ProjectSettingsLayout } from "@/components/project/ProjectSettingsLayout";
import {
  useProjectInvitesQuery,
  useProjectMembersQuery,
  useProjectRolePermissionsQuery,
} from "@/hooks/useProjectQueries";
import {
  type ProjectMember,
  type ProjectInvite,
  type ProjectPermissions,
} from "@/services/project.service";
import { Settings2, ChevronRight, Sparkles } from "lucide-react";

export const Route = createFileRoute("/project/$projectId/settings/team")({
  component: TeamSettingsPage,
});

// Static permission templates matching backend PERMISSION_TEMPLATES
const ROLE_TEMPLATES: Record<"consultant" | "client" | "freelancer", ProjectPermissions> = {
  consultant: {
    access: { roadmap: true, work_items: true, team: true, time: true, chat: true, resources: true, project_settings: true },
    roadmap: { edit: true, comment: true, promote: true, assign: true, edit_metadata: true, view_internal: true, create_tasks: true, edit_tasks: true, share: true, export: true, dev_mode: true },
    members: { view: true, manage: true, edit_permissions: true },
    project: { settings: true, edit_content: true, view_internal_content: true },
    time: { view: true, view_financial: true, log: true, edit_own: true, edit_team: true, approve: true, manage_rates: true, delete_logs: true },
    chat: { view_channels: true, send_messages: true, create_channels: true, manage_channels: true, view_internal_channels: true, mention_members: true, share_files: true, start_dm: true, send_dm: true, message_clients: true, message_consultants: true, message_freelancers: true },
    resources: { view: true, upload: true, delete: true },
    logs: { view: true, view_sensitive: true },
  },
  client: {
    access: { roadmap: true, work_items: true, team: true, time: false, chat: true, resources: true, project_settings: false },
    roadmap: { edit: true, comment: true, promote: true, assign: false, edit_metadata: true, view_internal: false, create_tasks: false, edit_tasks: false, share: false, export: false, dev_mode: false },
    members: { view: true, manage: false, edit_permissions: false },
    project: { settings: false, edit_content: true, view_internal_content: false },
    time: { view: false, view_financial: false, log: false, edit_own: false, edit_team: false, approve: false, manage_rates: false, delete_logs: false },
    chat: { view_channels: true, send_messages: true, create_channels: false, manage_channels: false, view_internal_channels: false, mention_members: true, share_files: true, start_dm: true, send_dm: true, message_clients: false, message_consultants: true, message_freelancers: false },
    resources: { view: true, upload: true, delete: false },
    logs: { view: false, view_sensitive: false },
  },
  freelancer: {
    access: { roadmap: true, work_items: true, team: true, time: false, chat: true, resources: true, project_settings: false },
    roadmap: { edit: false, comment: true, promote: false, assign: false, edit_metadata: false, view_internal: false, create_tasks: true, edit_tasks: true, share: false, export: false, dev_mode: false },
    members: { view: true, manage: false, edit_permissions: false },
    project: { settings: false, edit_content: false, view_internal_content: false },
    time: { view: false, view_financial: false, log: true, edit_own: true, edit_team: false, approve: false, manage_rates: false, delete_logs: false },
    chat: { view_channels: true, send_messages: true, create_channels: false, manage_channels: false, view_internal_channels: false, mention_members: true, share_files: true, start_dm: true, send_dm: true, message_clients: false, message_consultants: true, message_freelancers: true },
    resources: { view: true, upload: true, delete: false },
    logs: { view: false, view_sensitive: false },
  },
};

type RoleTemplateKey = keyof typeof ROLE_TEMPLATES;

function isValidPermissions(obj: unknown): obj is ProjectPermissions {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "access" in obj &&
    "roadmap" in obj &&
    typeof (obj as Record<string, unknown>).access === "object"
  );
}

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

const PERM_SECTIONS: Array<{ key: keyof ProjectPermissions; label: string }> = [
  { key: "access", label: "Access" },
  { key: "roadmap", label: "Roadmap" },
  { key: "members", label: "Members" },
  { key: "project", label: "Project" },
  { key: "time", label: "Time" },
  { key: "chat", label: "Chat" },
  { key: "resources", label: "Resources" },
  { key: "logs", label: "Logs" },
];

function countEnabled(section: Record<string, boolean>): [number, number] {
  const vals = Object.values(section);
  return [vals.filter(Boolean).length, vals.length];
}

function formatJoined(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getInitials(member: ProjectMember): string {
  const name =
    member.user?.display_name ||
    [member.user?.first_name, member.user?.last_name].filter(Boolean).join(" ") ||
    member.user?.email ||
    "?";
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function getDisplayName(member: ProjectMember): string {
  return (
    member.user?.display_name ||
    [member.user?.first_name, member.user?.last_name].filter(Boolean).join(" ") ||
    member.user?.email ||
    "Unknown"
  );
}

// Returns true if this member has any permission set to true that the role template has false.
// These are "custom grants" — extra permissions beyond what the role default provides.
function hasCustomGrants(
  member: ProjectMember,
  template: ProjectPermissions,
): boolean {
  if (!member.permissions_json) return false;
  const perms = member.permissions_json as unknown as Record<string, Record<string, boolean>>;
  const tmpl = template as unknown as Record<string, Record<string, boolean>>;
  for (const section of Object.keys(tmpl)) {
    const memberSection = perms[section] ?? {};
    const templateSection = tmpl[section];
    for (const key of Object.keys(templateSection)) {
      if (memberSection[key] === true && templateSection[key] === false) {
        return true;
      }
    }
  }
  return false;
}

function PermissionSummary({
  template,
  loading = false,
}: {
  template: ProjectPermissions;
  loading?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
      {PERM_SECTIONS.map(({ key, label }) => {
        const section = template[key] as Record<string, boolean>;
        const [on, total] = countEnabled(section);
        const all = on === total;
        const none = on === 0;
        const badgeText = loading ? "..." : `${on}/${total}`;
        return (
          <div key={key} className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500">{label}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                loading
                  ? "bg-slate-100 text-slate-400"
                  : all
                  ? "bg-emerald-100 text-emerald-700"
                  : none
                    ? "bg-slate-100 text-slate-400"
                    : "bg-amber-100 text-amber-700"
              }`}
            >
              {badgeText}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface RoleGroupProps {
  role: "consultant" | "client" | "member";
  members: ProjectMember[];
  inviteMap: Map<string, ProjectInvite>;
  projectId: string;
  template: ProjectPermissions;
  templateLoading?: boolean;
}

function RoleGroup({
  role,
  members,
  inviteMap,
  projectId,
  template,
  templateLoading = false,
}: RoleGroupProps) {
  const navigate = useNavigate();
  const label = ROLE_LABELS[role];
  const colorClass = ROLE_COLORS[role];
  const templateKey = role === "member" ? "freelancer" : role;

  return (
    <section className="app-surface-card-strong overflow-hidden rounded-2xl">
      {/* Role header */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${colorClass}`}
          >
            {label}
          </span>
          <span className="text-sm text-slate-500">
            {members.length} {members.length === 1 ? "member" : "members"}
          </span>
        </div>
      </header>

      {/* Member list */}
      {members.length === 0 ? (
        <div className="px-5 py-5 text-sm text-slate-400">
          No {label.toLowerCase()} members yet.
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {members.map((member) => {
            const invite = member.user_id ? inviteMap.get(member.user_id) : undefined;
            const inviterName = invite?.inviter?.display_name ?? null;
            const initials = getInitials(member);
            const displayName = getDisplayName(member);
            const isCustomized = hasCustomGrants(member, template);

            return (
              <div
                key={member.id}
                className="flex items-center justify-between gap-4 px-5 py-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Avatar */}
                  <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-600">
                    {member.user?.avatar_url ? (
                      <img
                        src={member.user.avatar_url}
                        alt={displayName}
                        className="h-9 w-9 rounded-full object-cover"
                      />
                    ) : (
                      initials
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {displayName}
                      </p>
                      {isCustomized && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200">
                          <Sparkles className="h-2.5 w-2.5" />
                          Custom grants
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-slate-500">
                      {member.user?.email || "No email"}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      {member.position && (
                        <span className="text-xs text-slate-400">
                          {member.position}
                        </span>
                      )}
                      <span className="text-xs text-slate-400">
                        Joined {formatJoined(member.joined_at)}
                      </span>
                      <span className="text-xs text-slate-400">
                        {inviterName
                          ? `Invited by ${inviterName}`
                          : "Direct assignment"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Advanced link */}
                <button
                  onClick={() =>
                    void navigate({
                      to: "/project/$projectId/settings/permissions",
                      params: { projectId },
                      search: { memberId: member.id },
                    })
                  }
                  className="shrink-0 flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Advanced
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Default permissions panel */}
      <div className="border-t border-slate-200 bg-slate-50/60 px-5 py-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Default {label} Permissions
          </p>
          <button
            onClick={() =>
              void navigate({
                to: "/project/$projectId/settings/permissions",
                params: { projectId },
                search: { role: templateKey },
              })
            }
            className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
          >
            <Settings2 className="h-3 w-3" />
            Edit Permissions
          </button>
        </div>
        <PermissionSummary template={template} loading={templateLoading} />
      </div>
    </section>
  );
}

function TeamSettingsPage() {
  const { projectId } = Route.useParams();

  // Use cached TanStack Query for instant loads on revisit
  const membersQuery = useProjectMembersQuery(projectId);
  const members = (membersQuery.data as ProjectMember[] | undefined) ?? [];
  const isLoading = membersQuery.isLoading;

  const invitesQuery = useProjectInvitesQuery(projectId);
  const invites = (invitesQuery.data as ProjectInvite[] | undefined) ?? [];
  const inviteMap = useMemo(() => {
    const map = new Map<string, ProjectInvite>();
    for (const inv of invites) {
      if (inv.invitee_id) map.set(inv.invitee_id, inv);
    }
    return map;
  }, [invites]);

  const consultantRoleQuery = useProjectRolePermissionsQuery(
    projectId,
    "consultant",
  );
  const clientRoleQuery = useProjectRolePermissionsQuery(projectId, "client");
  const freelancerRoleQuery = useProjectRolePermissionsQuery(
    projectId,
    "freelancer",
  );

  const roleTemplates: Record<RoleTemplateKey, ProjectPermissions> = {
    consultant: isValidPermissions(consultantRoleQuery.data)
      ? consultantRoleQuery.data
      : ROLE_TEMPLATES.consultant,
    client: isValidPermissions(clientRoleQuery.data)
      ? clientRoleQuery.data
      : ROLE_TEMPLATES.client,
    freelancer: isValidPermissions(freelancerRoleQuery.data)
      ? freelancerRoleQuery.data
      : ROLE_TEMPLATES.freelancer,
  };

  const roleTemplateLoading: Record<RoleTemplateKey, boolean> = {
    consultant: consultantRoleQuery.isLoading && !consultantRoleQuery.data,
    client: clientRoleQuery.isLoading && !clientRoleQuery.data,
    freelancer: freelancerRoleQuery.isLoading && !freelancerRoleQuery.data,
  };

  const consultants = members.filter((m) => m.role === "consultant");
  const clients = members.filter((m) => m.role === "client");
  const freelancers = members.filter((m) => m.role === "member");

  return (
    <ProjectSettingsLayout projectId={projectId}>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Roles &amp; Permissions</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Members grouped by role with default permissions.
          </p>
        </div>
        <Link
          to="/project/$projectId/team"
          params={{ projectId }}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Full team view
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <RoleGroup
            role="consultant"
            members={consultants}
            inviteMap={inviteMap}
            projectId={projectId}
            template={roleTemplates.consultant}
            templateLoading={roleTemplateLoading.consultant}
          />
          <RoleGroup
            role="client"
            members={clients}
            inviteMap={inviteMap}
            projectId={projectId}
            template={roleTemplates.client}
            templateLoading={roleTemplateLoading.client}
          />
          <RoleGroup
            role="member"
            members={freelancers}
            inviteMap={inviteMap}
            projectId={projectId}
            template={roleTemplates.freelancer}
            templateLoading={roleTemplateLoading.freelancer}
          />
        </div>
      )}
    </ProjectSettingsLayout>
  );
}
