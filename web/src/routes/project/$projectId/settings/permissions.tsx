import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ChevronRight, HelpCircle, Search } from "lucide-react";
import { ProjectSettingsLayout } from "@/components/project/ProjectSettingsLayout";
import { projectKeys } from "@/queries/project";
import { useToast } from "@/hooks/useToast";
import {
  PermissionDependencyError,
  projectService,
  type ProjectPermissions,
  type ProjectMember,
} from "@/services/project.service";
import {
  useProjectMembersQuery,
  useProjectMyPermissionsQuery,
} from "@/hooks/useProjectQueries";
import { PositionCell } from "@/components/project/team/PositionCell";
import {
  PERMISSION_SECTIONS,
  type PermissionMeta,
  type PermissionSectionMeta,
} from "@/components/project/permissions/permissionCatalog";

export const Route = createFileRoute("/project/$projectId/settings/permissions")({
  component: PermissionsRoute,
  validateSearch: (
    search: Record<string, unknown>,
  ): { role?: string; memberId?: string; tab?: "team" | "catalog" } => ({
    role: (search.role as string) || undefined,
    memberId: (search.memberId as string) || undefined,
    tab:
      search.tab === "catalog"
        ? "catalog"
        : search.tab === "team"
          ? "team"
          : undefined,
  }),
});

// Top-level dispatcher.
//   ?memberId=… or ?role=…   → per-target editor
//   ?tab=catalog              → reference catalogue
//   default                   → team-permissions list (per-member overview)
//
// The header + tab strip live in the shell so switching tabs never
// remounts them; only the body content swaps.
function PermissionsRoute() {
  const { memberId, role, tab } = Route.useSearch();
  if (memberId || role) return <PermissionsSettingsPage />;
  const active: "team" | "catalog" = tab === "catalog" ? "catalog" : "team";
  return <PermissionsShell active={active} />;
}

function PermissionsShell({ active }: { active: "team" | "catalog" }) {
  const { projectId } = Route.useParams();
  return (
    <ProjectSettingsLayout projectId={projectId}>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">Permissions</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Manage member permissions and review the full capability catalog.
        </p>
      </div>

      <PermissionsTabs active={active} projectId={projectId} />

      {active === "team" ? (
        <TeamPermissionsBody projectId={projectId} />
      ) : (
        <CatalogPermissionsBody projectId={projectId} />
      )}
    </ProjectSettingsLayout>
  );
}

// ─── Dependency enforcement (mirrors PermissionsDrawer) ────────────────────

type SectionKey = keyof ProjectPermissions;
type AccessGateKey = keyof ProjectPermissions["access"];

const SECTION_ACCESS_REQUIREMENTS: Partial<Record<SectionKey, AccessGateKey>> = {
  roadmap: "roadmap",
  members: "team",
  project: "project_settings",
  time: "time",
  chat: "chat",
  resources: "resources",
  // Logs are part of project settings access.
  logs: "project_settings",
};

const ACCESS_GATE_LABELS: Record<AccessGateKey, string> = {
  roadmap: "Access Roadmap",
  work_items: "Access Work Items",
  team: "Access Team",
  time: "Access Time",
  chat: "Access Chat",
  resources: "Access Resources",
  project_settings: "Access Project Settings",
};

const DEPENDENCIES: Array<[SectionKey, string, SectionKey, string]> = [
  ["access", "work_items", "access", "roadmap"],
  ["roadmap", "edit", "access", "roadmap"],
  ["roadmap", "comment", "access", "roadmap"],
  ["roadmap", "promote", "access", "roadmap"],
  ["roadmap", "assign", "access", "roadmap"],
  ["roadmap", "assign", "members", "view"],
  ["roadmap", "edit_metadata", "access", "roadmap"],
  ["roadmap", "view_internal", "access", "roadmap"],
  ["roadmap", "create_tasks", "access", "roadmap"],
  ["roadmap", "edit_tasks", "access", "roadmap"],
  ["roadmap", "share", "access", "roadmap"],
  ["roadmap", "export", "access", "roadmap"],
  ["roadmap", "dev_mode", "access", "roadmap"],
  ["members", "manage", "members", "view"],
  ["members", "edit_permissions", "members", "view"],
  ["project", "settings", "access", "project_settings"],
  ["project", "edit_content", "access", "project_settings"],
  ["project", "view_internal_content", "access", "project_settings"],
  ["time", "view_financial", "time", "view"],
  ["time", "log", "time", "view"],
  ["time", "edit_own", "time", "view"],
  ["time", "edit_team", "time", "view"],
  ["time", "approve", "time", "view"],
  ["time", "manage_rates", "time", "view"],
  ["time", "delete_logs", "time", "edit_team"],
  ["chat", "view_channels", "access", "chat"],
  ["chat", "send_messages", "access", "chat"],
  ["chat", "send_messages", "chat", "view_channels"],
  ["chat", "create_channels", "access", "chat"],
  ["chat", "create_channels", "chat", "view_channels"],
  ["chat", "manage_channels", "access", "chat"],
  ["chat", "manage_channels", "chat", "view_channels"],
  ["chat", "view_internal_channels", "access", "chat"],
  ["chat", "view_internal_channels", "chat", "view_channels"],
  ["chat", "mention_members", "chat", "send_messages"],
  ["chat", "share_files", "chat", "send_messages"],
  ["chat", "start_dm", "access", "chat"],
  ["chat", "send_dm", "chat", "start_dm"],
  ["chat", "message_clients", "chat", "start_dm"],
  ["chat", "message_clients", "chat", "send_dm"],
  ["chat", "message_consultants", "chat", "start_dm"],
  ["chat", "message_consultants", "chat", "send_dm"],
  ["chat", "message_freelancers", "chat", "start_dm"],
  ["chat", "message_freelancers", "chat", "send_dm"],
  ["resources", "upload", "resources", "view"],
  ["resources", "delete", "resources", "view"],
  ["logs", "view_sensitive", "logs", "view"],
];

function isValidPermissions(obj: unknown): obj is ProjectPermissions {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "access" in obj &&
    "roadmap" in obj &&
    typeof (obj as Record<string, unknown>).access === "object"
  );
}

function enforceDeps(permissions: ProjectPermissions): ProjectPermissions {
  const result = structuredClone(permissions) as unknown as Record<string, Record<string, boolean>>;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [cs, ck, ps, pk] of DEPENDENCIES) {
      const parent = result[ps as string];
      const child = result[cs as string];
      if (!parent || !child) continue;
      if (!parent[pk] && child[ck]) {
        child[ck] = false;
        changed = true;
      }
    }
  }
  return result as unknown as ProjectPermissions;
}

function propagateEnable(
  permissions: ProjectPermissions,
  section: SectionKey,
  key: string,
): ProjectPermissions {
  const result = structuredClone(permissions) as unknown as Record<string, Record<string, boolean>>;
  if (!result[section as string]) return permissions;
  result[section as string][key] = true;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [cs, ck, ps, pk] of DEPENDENCIES) {
      const child = result[cs as string];
      const parent = result[ps as string];
      if (!child || !parent) continue;
      if (child[ck] && !parent[pk]) {
        parent[pk] = true;
        changed = true;
      }
    }
  }
  return result as unknown as ProjectPermissions;
}

// ─── Permission section definitions ─────────────────────────────────────────
//
// Section labels, descriptions, dependencies live in
// `@/components/project/permissions/permissionCatalog`. This page consumes
// that catalog directly — the duplicated structure that used to live here is
// gone.

const CONSULTANT_LOCKED_SECTIONS: SectionKey[] = ["time", "chat", "logs"];

// ─── Default templates (matches backend PERMISSION_TEMPLATES) ────────────────

const ROLE_TEMPLATES: Record<string, ProjectPermissions> = {
  consultant: {
    access: { roadmap: true, work_items: true, team: true, time: true, chat: true, resources: true, project_settings: true },
    roadmap: { view: true, edit: true, comment: true, promote: true, assign: true, edit_metadata: true, view_internal: true, create_tasks: true, edit_tasks: true, share: true, export: true, dev_mode: true },
    members: { view: true, manage: true, edit_permissions: true, edit_position: true },
    project: { settings: true, edit_content: true, view_internal_content: true },
    time: { view: true, view_financial: true, log: true, edit_own: true, edit_team: true, approve: true, manage_rates: true, delete_logs: true },
    chat: { view_channels: true, send_messages: true, create_channels: true, manage_channels: true, view_internal_channels: true, mention_members: true, share_files: true, start_dm: true, send_dm: true, message_clients: true, message_consultants: true, message_freelancers: true },
    resources: { view: true, upload: true, delete: true },
    logs: { view: true, view_sensitive: true },
  },
  client: {
    access: { roadmap: true, work_items: true, team: true, time: false, chat: true, resources: true, project_settings: false },
    roadmap: { view: true, edit: true, comment: true, promote: true, assign: false, edit_metadata: true, view_internal: false, create_tasks: false, edit_tasks: false, share: false, export: false, dev_mode: false },
    members: { view: true, manage: false, edit_permissions: false, edit_position: false },
    project: { settings: false, edit_content: true, view_internal_content: false },
    time: { view: false, view_financial: false, log: false, edit_own: false, edit_team: false, approve: false, manage_rates: false, delete_logs: false },
    chat: { view_channels: true, send_messages: true, create_channels: false, manage_channels: false, view_internal_channels: false, mention_members: true, share_files: true, start_dm: true, send_dm: true, message_clients: false, message_consultants: true, message_freelancers: false },
    resources: { view: true, upload: true, delete: false },
    logs: { view: false, view_sensitive: false },
  },
  freelancer: {
    access: { roadmap: true, work_items: true, team: true, time: false, chat: true, resources: true, project_settings: false },
    roadmap: { view: true, edit: false, comment: true, promote: false, assign: false, edit_metadata: false, view_internal: false, create_tasks: true, edit_tasks: true, share: false, export: false, dev_mode: false },
    members: { view: true, manage: false, edit_permissions: false, edit_position: false },
    project: { settings: false, edit_content: false, view_internal_content: false },
    time: { view: false, view_financial: false, log: true, edit_own: true, edit_team: false, approve: false, manage_rates: false, delete_logs: false },
    chat: { view_channels: true, send_messages: true, create_channels: false, manage_channels: false, view_internal_channels: false, mention_members: true, share_files: true, start_dm: true, send_dm: true, message_clients: false, message_consultants: true, message_freelancers: true },
    resources: { view: true, upload: true, delete: false },
    logs: { view: false, view_sensitive: false },
  },
};

const ROLE_DISPLAY: Record<string, string> = {
  consultant: "Consultant",
  client: "Client",
  freelancer: "Freelancer",
};

// ─── Main page ───────────────────────────────────────────────────────────────

function PermissionsSettingsPage() {
  const { projectId } = Route.useParams();
  const { role, memberId } = Route.useSearch();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [permissions, setPermissions] = useState<ProjectPermissions | null>(null);
  const [initialPermissions, setInitialPermissions] = useState<ProjectPermissions | null>(null);
  const [defaultPermissions, setDefaultPermissions] = useState<ProjectPermissions | null>(null);
  const [member, setMember] = useState<ProjectMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRoleMode = !!role && !memberId;
  const isMemberMode = !!memberId;
  const isConsultantRole = role === "consultant";

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      setPermissions(null);
      setInitialPermissions(null);
      setDefaultPermissions(null);
      setMember(null);

      try {
        if (isRoleMode && role) {
          const hardcoded = ROLE_TEMPLATES[role];
          if (!hardcoded) throw new Error(`Unknown role: ${role}`);
          const hardcodedNorm = enforceDeps(structuredClone(hardcoded));

          // Fetch any saved overrides for this role from the backend.
          const saved = await projectService.getRolePermissions(projectId, role);
          const loaded = isValidPermissions(saved)
            ? enforceDeps(structuredClone(saved))
            : structuredClone(hardcodedNorm);

          if (!cancelled) {
            setPermissions(loaded);
            setInitialPermissions(structuredClone(loaded));
            setDefaultPermissions(structuredClone(hardcodedNorm));
          }
        } else if (isMemberMode && memberId) {
          const [perms, members] = await Promise.all([
            projectService.getMemberPermissions(projectId, memberId),
            projectService.getMembers(projectId),
          ]);
          const found = members.find((m) => m.id === memberId) ?? null;
          let resolvedDefaultTemplate: ProjectPermissions | null = null;

          if (found) {
            const templateKey =
              found.role === "consultant"
                ? "consultant"
                : found.role === "client"
                  ? "client"
                  : "freelancer";
            const fallbackTemplate = ROLE_TEMPLATES[templateKey];
            const savedRoleTemplate = await projectService.getRolePermissions(
              projectId,
              templateKey,
            );
            resolvedDefaultTemplate = isValidPermissions(savedRoleTemplate)
              ? enforceDeps(structuredClone(savedRoleTemplate))
              : enforceDeps(structuredClone(fallbackTemplate));
          }

          if (!cancelled) {
            const normalized = enforceDeps(structuredClone(perms));
            setPermissions(normalized);
            setInitialPermissions(structuredClone(normalized));
            setMember(found);
            if (resolvedDefaultTemplate) {
              setDefaultPermissions(resolvedDefaultTemplate);
            }
          }
        } else {
          throw new Error("No role or member specified.");
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load permissions.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId, role, memberId]);

  const setPermission = (section: SectionKey, key: string, checked: boolean) => {
    setPermissions((prev) => {
      if (!prev) return prev;
      const requiredAccessGate = SECTION_ACCESS_REQUIREMENTS[section];
      if (
        requiredAccessGate &&
        prev.access[requiredAccessGate] !== true
      ) {
        return prev;
      }
      if (checked) return propagateEnable(prev, section, key);
      const next = structuredClone(prev) as unknown as Record<string, Record<string, boolean>>;
      next[section as string][key] = false;
      return enforceDeps(next as unknown as ProjectPermissions);
    });
  };

  const isDirty =
    permissions !== null &&
    initialPermissions !== null &&
    JSON.stringify(permissions) !== JSON.stringify(initialPermissions);

  const isPermissionChanged = (section: SectionKey, key: string): boolean => {
    if (!permissions || !initialPermissions) return false;
    const cur = (permissions[section] as Record<string, boolean>)[key];
    const init = (initialPermissions[section] as Record<string, boolean>)[key];
    return cur !== init;
  };

  // True when the saved value differs from the role default template.
  const isModifiedFromDefault = (section: SectionKey, key: string): boolean => {
    if (!initialPermissions || !defaultPermissions) return false;
    const saved = (initialPermissions[section] as Record<string, boolean>)[key];
    const def = (defaultPermissions[section] as Record<string, boolean>)[key];
    return saved !== def;
  };

  const handleDiscard = () => {
    if (initialPermissions) setPermissions(structuredClone(initialPermissions));
  };

  const handleSave = async () => {
    if (!permissions) return;
    setSaving(true);
    setError(null);
    try {
      if (isRoleMode && role) {
        const apiRole = role === "freelancer" ? "member" : role;
        await projectService.updateRolePermissions(projectId, apiRole, permissions);
        queryClient.setQueryData(
          projectKeys.rolePermissions(projectId, role),
          structuredClone(permissions),
        );
        void queryClient.invalidateQueries({
          queryKey: projectKeys.rolePermissions(projectId, role),
        });
        void queryClient.invalidateQueries({
          queryKey: projectKeys.members(projectId),
        });
        toast.success(
          `${ROLE_DISPLAY[role] ?? role} permissions updated for all members.`,
        );
      } else if (isMemberMode && memberId) {
        try {
          await projectService.updateMemberPermissions(projectId, memberId, permissions);
        } catch (saveErr) {
          // Server-side dependency check: if the patch is missing any
          // prereqs, auto-tick them and retry once. Belt-and-suspenders
          // for the client-side dep enforcement above.
          if (
            saveErr instanceof PermissionDependencyError &&
            saveErr.code === "permission_dependency_unmet" &&
            saveErr.missing
          ) {
            const patched = structuredClone(permissions);
            for (const violation of saveErr.missing) {
              for (const req of violation.requires) {
                const [section, field] = req.split(".");
                /* eslint-disable @typescript-eslint/no-explicit-any */
                if ((patched as any)[section]) {
                  (patched as any)[section][field] = true;
                }
                /* eslint-enable @typescript-eslint/no-explicit-any */
              }
            }
            setPermissions(patched);
            await projectService.updateMemberPermissions(projectId, memberId, patched);
            toast.success(
              "Member permissions updated (prerequisites auto-granted).",
            );
            await navigate({
              to: "/project/$projectId/settings/permissions",
              params: { projectId },
            });
            return;
          }
          throw saveErr;
        }
        toast.success("Member permissions updated.");
      }
      await navigate({
        to: "/project/$projectId/settings/permissions",
        params: { projectId },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save permissions.");
    } finally {
      setSaving(false);
    }
  };

  // Search across the catalog (label, path, description)
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const visibleSections = useMemo<PermissionSectionMeta[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PERMISSION_SECTIONS;
    return PERMISSION_SECTIONS.map((section) => ({
      ...section,
      permissions: section.permissions.filter(
        (perm) =>
          perm.path.toLowerCase().includes(q) ||
          perm.label.toLowerCase().includes(q) ||
          perm.description.toLowerCase().includes(q),
      ),
    })).filter((s) => s.permissions.length > 0);
  }, [query]);

  const pageTitle = isRoleMode
    ? `${ROLE_DISPLAY[role ?? ""] ?? role} Default Permissions`
    : member
      ? `${member.user?.display_name || member.user?.email || "Member"} — Permissions`
      : "Member Permissions";

  const pageSubtitle = isRoleMode
    ? `Changes apply to all ${ROLE_DISPLAY[role ?? ""] ?? role} members in this project.`
    : "Custom overrides for this specific member.";

  return (
    <ProjectSettingsLayout projectId={projectId}>
      {/* Page header */}
      <div className="mb-6">
        <Link
          to="/project/$projectId/settings/permissions"
          params={{ projectId }}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Team
        </Link>
        <h2 className="text-xl font-semibold text-slate-900">{pageTitle}</h2>
        <p className="mt-0.5 text-sm text-slate-500">{pageSubtitle}</p>
        {isMemberMode && member && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-semibold uppercase tracking-wide text-slate-700">
              Role: {member.role}
            </span>
            {member.origin && (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-semibold uppercase tracking-wide text-slate-700">
                Origin: {member.origin}
              </span>
            )}
            <span className="text-slate-500">
              Overrides on this row layer on top of the role + origin
              baseline.
            </span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-2xl bg-slate-100"
            />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          {error}
        </div>
      ) : permissions ? (
        <div className="space-y-4 pb-24">
          {/* Search */}
          <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
            <div className="flex flex-1 items-center gap-2">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by name, path, or description"
                className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
            </div>
            <span className="shrink-0 text-xs text-slate-500">
              {visibleSections.reduce((n, s) => n + s.permissions.length, 0)}{" "}
              permissions
            </span>
          </div>

          <div className="rounded-md border border-slate-200 bg-white">
            <div className="grid grid-cols-[44px_minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,1.2fr)] border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <span />
              <span>Permission</span>
              <span>Description</span>
              <span className="flex items-center gap-1.5">
                Dependencies
                <DependenciesHelp />
              </span>
            </div>

            {visibleSections.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-slate-500">
                No permissions match "{query}".
              </div>
            ) : (
              visibleSections.map((section) => {
                const isLockedSection =
                  isConsultantRole &&
                  CONSULTANT_LOCKED_SECTIONS.includes(section.key);
                const requiredAccessGate =
                  SECTION_ACCESS_REQUIREMENTS[section.key];
                const isAccessBlocked =
                  section.key !== "access" &&
                  !!requiredAccessGate &&
                  permissions.access[requiredAccessGate] !== true;
                const isSectionDisabled = isLockedSection || isAccessBlocked;
                const isCollapsed = collapsed[section.key] === true;

                return (
                  <SectionBlock
                    key={section.key}
                    section={section}
                    permissions={permissions}
                    collapsed={isCollapsed}
                    onToggle={() =>
                      setCollapsed((prev) => ({
                        ...prev,
                        [section.key]: !prev[section.key],
                      }))
                    }
                    sectionDisabled={isSectionDisabled}
                    sectionDisabledReason={
                      isLockedSection
                        ? "Always enabled for consultants."
                        : isAccessBlocked && requiredAccessGate
                          ? `Enable ${ACCESS_GATE_LABELS[requiredAccessGate]} in Access first.`
                          : null
                    }
                    isLockedSection={isLockedSection}
                    saving={saving}
                    onToggleField={(field, checked) =>
                      setPermission(section.key, field, checked)
                    }
                    isPermissionChanged={isPermissionChanged}
                    isModifiedFromDefault={isModifiedFromDefault}
                  />
                );
              })
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      ) : null}

      {/* Floating save bar rendered into document.body to escape parent transforms */}
      {createPortal(
        <div
          className={`fixed bottom-6 left-1/2 z-9999 -translate-x-1/2 transition-all duration-300 ${
            isDirty
              ? "translate-y-0 opacity-100 pointer-events-auto"
              : "translate-y-4 opacity-0 pointer-events-none"
          }`}
        >
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-xl shadow-slate-900/10 ring-1 ring-slate-900/5">
            <span className="text-sm text-slate-500">You have unsaved changes</span>
            <div className="h-4 w-px bg-slate-200" />
            <button
              type="button"
              onClick={handleDiscard}
              disabled={saving}
              className="text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </ProjectSettingsLayout>
  );
}

// ─── Section block ───────────────────────────────────────────────────────────

function SectionBlock({
  section,
  permissions,
  collapsed,
  onToggle,
  sectionDisabled,
  sectionDisabledReason,
  isLockedSection,
  saving,
  onToggleField,
  isPermissionChanged,
  isModifiedFromDefault,
}: {
  section: PermissionSectionMeta;
  permissions: ProjectPermissions;
  collapsed: boolean;
  onToggle: () => void;
  sectionDisabled: boolean;
  sectionDisabledReason: string | null;
  isLockedSection: boolean;
  saving: boolean;
  onToggleField: (field: string, checked: boolean) => void;
  isPermissionChanged: (section: SectionKey, key: string) => boolean;
  isModifiedFromDefault: (section: SectionKey, key: string) => boolean;
}) {
  return (
    <section className="border-b border-slate-200 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 bg-slate-900 px-4 py-3 text-left transition-colors hover:bg-slate-800"
      >
        <motion.span
          initial={false}
          animate={{ rotate: collapsed ? 0 : 90 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="flex"
        >
          <ChevronRight className="h-4 w-4 text-slate-400" />
        </motion.span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-white">
              {section.label}
            </span>
            <span className="text-[11px] text-slate-400">
              {section.permissions.length}{" "}
              {section.permissions.length === 1 ? "permission" : "permissions"}
            </span>
          </div>
          <p className="truncate text-xs text-slate-400">
            {section.description}
          </p>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="rows"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            {sectionDisabledReason && (
              <p className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">
                {sectionDisabledReason}
              </p>
            )}
            <div className="divide-y divide-slate-100">
              {section.permissions.map((perm) => {
                const group = permissions[section.key] as Record<string, boolean>;
                const checked = isLockedSection ? true : group[perm.field] === true;
                const changed = !sectionDisabled && isPermissionChanged(section.key, perm.field);
                const modified = !sectionDisabled && isModifiedFromDefault(section.key, perm.field);
                return (
                  <PermissionRow
                    key={perm.path}
                    perm={perm}
                    checked={checked}
                    disabled={sectionDisabled || saving}
                    changed={changed}
                    modified={modified}
                    onChange={(value) => onToggleField(perm.field, value)}
                  />
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function PermissionRow({
  perm,
  checked,
  disabled,
  changed,
  modified,
  onChange,
}: {
  perm: PermissionMeta;
  checked: boolean;
  disabled: boolean;
  changed: boolean;
  modified: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className={`grid grid-cols-[44px_minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,1.2fr)] items-start gap-4 px-4 py-3 transition-colors ${
        disabled
          ? "cursor-not-allowed bg-slate-50/60 opacity-70"
          : "cursor-pointer hover:bg-slate-50"
      }`}
    >
      <div className="flex h-5 items-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-900/20 disabled:opacity-60"
        />
      </div>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
          <span className="truncate">{perm.label}</span>
          {modified && (
            <span className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
              custom
            </span>
          )}
          {changed && (
            <span className="rounded border border-slate-900 bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              edited
            </span>
          )}
        </p>
        <code className="mt-0.5 block truncate font-mono text-[11px] text-slate-500">
          {perm.path}
        </code>
      </div>
      <p className="text-sm leading-relaxed text-slate-600">
        {perm.description}
      </p>
      <div className="flex flex-wrap gap-1">
        {perm.requires?.length ? (
          perm.requires.map((req) => (
            <code
              key={req}
              title={`Requires ${req}`}
              className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-600"
            >
              {req}
            </code>
          ))
        ) : (
          <span className="text-[11px] text-slate-400">—</span>
        )}
      </div>
    </label>
  );
}

// ─── Tab strip (Team permissions | Permissions catalog) ────────────────────

function PermissionsTabs({
  active,
  projectId,
}: {
  active: "team" | "catalog";
  projectId: string;
}) {
  const tabs: Array<{ key: "team" | "catalog"; label: string }> = [
    { key: "team", label: "Team permissions" },
    { key: "catalog", label: "Permissions catalog" },
  ];
  return (
    <div className="mb-5 inline-flex rounded-md border border-slate-200 bg-white p-0.5">
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <Link
            key={t.key}
            to="/project/$projectId/settings/permissions"
            params={{ projectId }}
            search={t.key === "team" ? {} : { tab: "catalog" }}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

// ─── Team permissions body (default tab) ───────────────────────────────────

function TeamPermissionsBody({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const membersQuery = useProjectMembersQuery(projectId);
  const myPermissionsQuery = useProjectMyPermissionsQuery(projectId);
  const members =
    (membersQuery.data as ProjectMember[] | undefined) ?? [];
  const canManage = Boolean(myPermissionsQuery.data?.members.manage);
  const canEditOthersPosition = Boolean(
    myPermissionsQuery.data?.members.edit_position,
  );
  const [query, setQuery] = useState("");

  const updatePositionMutation = useMutation({
    mutationFn: ({
      memberId,
      position,
    }: {
      memberId: string;
      position: string;
    }) => projectService.updateMemberPosition(projectId, memberId, position),
    onSuccess: (_data, variables) => {
      queryClient.setQueryData<ProjectMember[]>(
        projectKeys.members(projectId),
        (current) =>
          current?.map((m) =>
            m.id === variables.memberId
              ? { ...m, position: variables.position || null }
              : m,
          ),
      );
      void queryClient.invalidateQueries({
        queryKey: projectKeys.detail(projectId),
      });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Couldn't save position");
    },
  });

  const handleSavePosition = useCallback(
    async (memberId: string, next: string) => {
      await updatePositionMutation.mutateAsync({ memberId, position: next });
    },
    [updatePositionMutation],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => {
      const hay = [
        m.user?.display_name,
        m.user?.email,
        m.user?.first_name,
        m.user?.last_name,
        m.position,
        m.role,
        m.origin,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [members, query]);

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
        <div className="flex flex-1 items-center gap-2">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, email, position, or role"
            className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
        </div>
        <span className="shrink-0 text-xs text-slate-500">
          {visible.length} member{visible.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="rounded-md border border-slate-200 bg-white">
        <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_120px] border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <span>Member</span>
          <span>Position</span>
          <span>Role</span>
          <span>Origin</span>
          <span />
        </div>

        {membersQuery.isPending ? (
          <div className="px-4 py-12 text-center text-sm text-slate-500">
            Loading members…
          </div>
        ) : visible.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-slate-500">
            {members.length === 0
              ? "No members yet."
              : `No members match "${query}".`}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visible.map((m) => (
              <li
                key={m.id}
                className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_120px] items-center gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {m.user?.display_name ||
                      [m.user?.first_name, m.user?.last_name]
                        .filter(Boolean)
                        .join(" ") ||
                      m.user?.email ||
                      "Unknown"}
                  </p>
                  {m.user?.email && (
                    <p className="truncate text-[11px] text-slate-500">
                      {m.user.email}
                    </p>
                  )}
                </div>
                <PositionCell
                  value={m.position ?? null}
                  fallback="—"
                  canEdit={canEditOthersPosition}
                  onSave={(next) => handleSavePosition(m.id, next)}
                  displayName={
                    m.user?.display_name ||
                    [m.user?.first_name, m.user?.last_name]
                      .filter(Boolean)
                      .join(" ") ||
                    m.user?.email ||
                    undefined
                  }
                />

                <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                  {m.role}
                </span>
                <span className="truncate text-[11px] uppercase tracking-wide text-slate-500">
                  {m.origin || "—"}
                </span>
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={!canManage}
                    onClick={() =>
                      void navigate({
                        to: "/project/$projectId/settings/permissions",
                        params: { projectId },
                        search: { memberId: m.id },
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    title={
                      canManage
                        ? "Edit permissions"
                        : "You need members.manage to edit permissions"
                    }
                  >
                    Edit
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!canManage && (
        <p className="mt-3 text-xs text-slate-500">
          Read-only — ask a project owner or admin for{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-700">
            members.edit_permissions
          </code>{" "}
          to make changes.
        </p>
      )}
    </>
  );
}

// ─── Catalog body (?tab=catalog) ───────────────────────────────────────────

function CatalogPermissionsBody(_props: { projectId: string }) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const totalPermissions = useMemo(
    () => PERMISSION_SECTIONS.reduce((n, s) => n + s.permissions.length, 0),
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PERMISSION_SECTIONS;
    return PERMISSION_SECTIONS.map((section) => ({
      ...section,
      permissions: section.permissions.filter(
        (p) =>
          p.path.toLowerCase().includes(q) ||
          p.label.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q),
      ),
    })).filter((s) => s.permissions.length > 0);
  }, [query]);

  const matchingCount = useMemo(
    () => filtered.reduce((n, s) => n + s.permissions.length, 0),
    [filtered],
  );

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
        <div className="flex flex-1 items-center gap-2">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, path, or description"
            className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
        </div>
        <span className="shrink-0 text-xs text-slate-500">
          {matchingCount} of {totalPermissions}
        </span>
      </div>

      <div className="rounded-md border border-slate-200 bg-white">
        <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,1.2fr)] border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <span>Permission</span>
          <span>Description</span>
          <span className="flex items-center gap-1.5">
            Dependencies
            <DependenciesHelp />
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-slate-500">
            No permissions match "{query}".
          </div>
        ) : (
          filtered.map((section) => {
            const isCollapsed = collapsed[section.key] === true;
            return (
              <ReferenceSectionBlock
                key={section.key}
                section={section}
                collapsed={isCollapsed}
                onToggle={() =>
                  setCollapsed((prev) => ({
                    ...prev,
                    [section.key]: !prev[section.key],
                  }))
                }
              />
            );
          })
        )}
      </div>
    </>
  );
}

function ReferenceSectionBlock({
  section,
  collapsed,
  onToggle,
}: {
  section: PermissionSectionMeta;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="border-b border-slate-200 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 bg-slate-900 px-4 py-3 text-left transition-colors hover:bg-slate-800"
      >
        <motion.span
          initial={false}
          animate={{ rotate: collapsed ? 0 : 90 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="flex"
        >
          <ChevronRight className="h-4 w-4 text-slate-400" />
        </motion.span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-white">
              {section.label}
            </span>
            <span className="text-[11px] text-slate-400">
              {section.permissions.length}{" "}
              {section.permissions.length === 1 ? "permission" : "permissions"}
            </span>
          </div>
          <p className="truncate text-xs text-slate-400">
            {section.description}
          </p>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="rows"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="divide-y divide-slate-100">
              {section.permissions.map((p) => (
                <ReferenceRow key={p.path} perm={p} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function ReferenceRow({ perm }: { perm: PermissionMeta }) {
  return (
    <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,1.2fr)] items-start gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900">
          {perm.label}
        </p>
        <code className="mt-0.5 block truncate font-mono text-[11px] text-slate-500">
          {perm.path}
        </code>
      </div>
      <p className="text-sm leading-relaxed text-slate-600">
        {perm.description}
      </p>
      <div className="flex flex-wrap gap-1">
        {perm.requires?.length ? (
          perm.requires.map((req) => (
            <code
              key={req}
              title={`Requires ${req}`}
              className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-600"
            >
              {req}
            </code>
          ))
        ) : (
          <span className="text-[11px] text-slate-400">—</span>
        )}
      </div>
    </div>
  );
}

// ─── Dependencies help tooltip ───────────────────────────────────────────────

function DependenciesHelp() {
  const [open, setOpen] = useState(false);
  const tooltipId = "permissions-deps-help";
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-describedby={tooltipId}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900/20"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={tooltipId}
            role="tooltip"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute right-0 top-full z-30 mt-2 w-72 rounded-md border border-slate-200 bg-white p-3 text-[11px] font-normal normal-case tracking-normal text-slate-600 shadow-lg"
          >
            Some permissions need others to be granted first. The form
            auto-grants prerequisites when you save, but they're listed here so
            you can see the chain explicitly.
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}
