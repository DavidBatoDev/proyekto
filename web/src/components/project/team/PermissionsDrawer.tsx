import { useState, useRef, useEffect } from "react";
import { X, AlertTriangle } from "lucide-react";
import type { ProjectMember, ProjectPermissions } from "@/services/project.service";
import { projectService } from "@/services/project.service";
import { memberDisplayName } from "./utils";
import { useInvalidateProjectQueries } from "@/hooks/useProjectQueries";

type SectionKey = keyof ProjectPermissions;

// [childSection, childKey, parentSection, parentKey]
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

function enforceDeps(permissions: ProjectPermissions): ProjectPermissions {
  const result = structuredClone(permissions) as unknown as Record<string, Record<string, boolean>>;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [cs, ck, ps, pk] of DEPENDENCIES) {
      const parent = result[ps as string];
      const child = result[cs as string];
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
  // When enabling a child, also enable all its required parents
  let changed = true;
  result[section as string][key] = true;
  while (changed) {
    changed = false;
    for (const [cs, ck, ps, pk] of DEPENDENCIES) {
      const child = result[cs as string];
      const parent = result[ps as string];
      if (child[ck] && !parent[pk]) {
        parent[pk] = true;
        changed = true;
      }
    }
  }
  return result as unknown as ProjectPermissions;
}

const accessSection = {
  key: "access" as SectionKey,
  title: "Access Control",
  isAccessGate: true,
  items: [
    { key: "roadmap", label: "Access Roadmap", hint: "View the Roadmap page and its features." },
    { key: "work_items", label: "Access Work Items", hint: "View the Work Items execution table." },
    { key: "team", label: "Access Team", hint: "View the Members page." },
    { key: "chat", label: "Access Chat", hint: "View the project messaging system." },
    { key: "resources", label: "Access Resources", hint: "View project files and links." },
    { key: "project_settings", label: "Access Project Settings", hint: "View project settings and configuration." },
  ],
};

const actionSections: Array<{
  key: SectionKey;
  title: string;
  isAccessGate?: boolean;
  items: Array<{ key: string; label: string; hint: string }>;
}> = [
  {
    key: "roadmap",
    title: "Roadmap",
    items: [
      { key: "edit", label: "Edit", hint: "Create, edit, and delete epics, features, and reorder structure." },
      { key: "comment", label: "Comment", hint: "Add and manage comments on roadmap items." },
      { key: "promote", label: "Promote", hint: "Move items between stages and submit for approval." },
      { key: "assign", label: "Assign", hint: "Assign members to tasks and features." },
      { key: "edit_metadata", label: "Edit Metadata", hint: "Edit roadmap name, description, and category." },
      { key: "view_internal", label: "View Internal", hint: "See internal notes and hidden planning details." },
      { key: "create_tasks", label: "Create Tasks", hint: "Create tasks under features." },
      { key: "edit_tasks", label: "Edit Tasks", hint: "Modify task title, description, and due date." },
      { key: "share", label: "Share", hint: "Generate share links and grant external access." },
      { key: "export", label: "Export", hint: "Download and export roadmap data." },
      { key: "dev_mode", label: "Dev Mode", hint: "Access technical/developer view. Very sensitive." },
    ],
  },
  {
    key: "members",
    title: "Members",
    items: [
      { key: "view", label: "View", hint: "See team members, roles, and position titles." },
      { key: "manage", label: "Manage", hint: "Invite, remove, and edit team members." },
      { key: "edit_permissions", label: "Edit Permissions", hint: "Modify access control for other members." },
    ],
  },
  {
    key: "project",
    title: "Project",
    items: [
      { key: "settings", label: "Settings", hint: "Edit project title, summary, and configuration." },
      { key: "edit_content", label: "Edit Content", hint: "Edit overview sections, scope, and project banner." },
      { key: "view_internal_content", label: "View Internal Content", hint: "See internal project notes not visible to clients." },
    ],
  },
  {
    key: "chat",
    title: "Chat",
    items: [
      { key: "view_channels", label: "View Channels", hint: "Access project chat channels." },
      { key: "send_messages", label: "Send Messages", hint: "Send and reply to messages in channels." },
      { key: "create_channels", label: "Create Channels", hint: "Create new project chat channels." },
      { key: "manage_channels", label: "Manage Channels", hint: "Rename, archive, or delete channels." },
      { key: "view_internal_channels", label: "View Internal Channels", hint: "Access restricted channels not visible to all members." },
      { key: "mention_members", label: "Mention Members", hint: "Use @mentions to notify users in chat." },
      { key: "share_files", label: "Share Files", hint: "Attach files to chat messages." },
      { key: "start_dm", label: "Start Direct Messages", hint: "Initiate private conversations with members." },
      { key: "send_dm", label: "Send Direct Messages", hint: "Send messages in existing DM conversations." },
      { key: "message_clients", label: "Message Clients", hint: "Allowed to DM project clients." },
      { key: "message_consultants", label: "Message Consultants", hint: "Allowed to DM project consultants." },
      { key: "message_freelancers", label: "Message Freelancers", hint: "Allowed to DM project freelancers." },
    ],
  },
  {
    key: "resources",
    title: "Resources",
    items: [
      { key: "view", label: "View", hint: "Access project files and documents." },
      { key: "upload", label: "Upload", hint: "Add new files and resources." },
      { key: "delete", label: "Delete", hint: "Remove files permanently." },
    ],
  },
  {
    key: "logs",
    title: "Logs",
    items: [
      { key: "view", label: "View Logs", hint: "See project activity history." },
      { key: "view_sensitive", label: "View Sensitive Logs", hint: "Access restricted internal/system-level logs." },
    ],
  },
];

const CONSULTANT_LOCKED_SECTIONS: SectionKey[] = ["chat", "logs"];

interface PermissionsDrawerProps {
  open: boolean;
  member: ProjectMember | null;
  projectId: string;
  canEditPermissions: boolean;
  onMemberUpdated: (updated: ProjectMember) => void;
  onClose: () => void;
}

export function PermissionsDrawer({
  open,
  member,
  projectId,
  canEditPermissions,
  onMemberUpdated,
  onClose,
}: PermissionsDrawerProps) {
  const { invalidateMembers, invalidateProject } =
    useInvalidateProjectQueries(projectId);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<ProjectPermissions | null>(null);
  const [positionDraft, setPositionDraft] = useState("");
  const [entered, setEntered] = useState(false);
  const positionInputRef = useRef<HTMLInputElement>(null);
  const isConsultantMember = member?.role === "consultant";

  useEffect(() => {
    if (!open) return;
    setEntered(false);
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open || !member) return;

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      setPermissions(null);
      setPositionDraft(member.position || "");
      try {
        const value = await projectService.getMemberPermissions(projectId, member.id);
        if (!cancelled) setPermissions(value);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load permissions.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [open, member, projectId]);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => positionInputRef.current?.focus(), 160);
    return () => clearTimeout(id);
  }, [open]);

  const setPermission = (section: SectionKey, key: string, checked: boolean) => {
    setPermissions((prev) => {
      if (!prev) return prev;
      if (checked) {
        return propagateEnable(prev, section, key);
      }
      const next = structuredClone(prev) as unknown as Record<string, Record<string, boolean>>;
      next[section as string][key] = false;
      return enforceDeps(next as unknown as ProjectPermissions);
    });
  };

  const handleSave = async () => {
    if (!member || !permissions) return;
    setSaving(true);
    setError(null);
    try {
      const trimmedPosition = positionDraft.trim();
      if (trimmedPosition.length === 0) {
        throw new Error("Position title is required.");
      }

      const updatedMember = await projectService.updateMember(projectId, member.id, {
        position: trimmedPosition,
      });
      onMemberUpdated(updatedMember);

      if (canEditPermissions) {
        const updatedPermissions = await projectService.updateMemberPermissions(
          projectId,
          member.id,
          permissions,
        );
        setPermissions(updatedPermissions);
      }
      await invalidateMembers();
      await invalidateProject();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save permissions.");
    } finally {
      setSaving(false);
    }
  };

  if (!open || !member) return null;

  const allSections = [accessSection, ...actionSections];

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className={`absolute inset-0 bg-black/30 transition-opacity duration-300 ${entered ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
        aria-label="Close permissions panel"
      />
      <aside
        className={`absolute right-0 top-0 h-full w-full max-w-[430px] bg-white shadow-2xl border-l border-slate-200 flex flex-col transition-all duration-300 ease-out ${
          entered ? "translate-x-0 opacity-100" : "translate-x-8 opacity-0"
        }`}
      >
        <div className="px-5 py-4 border-b border-slate-200 bg-linear-to-r from-slate-50 to-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.12em] font-semibold text-[#b45f06]">
                Access Control
              </p>
              <h2 className="text-[18px] font-semibold text-slate-900 mt-0.5">
                Member Permissions
              </h2>
              <p className="text-[12px] text-slate-500 mt-1 truncate">
                {memberDisplayName(member)}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-white/70"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/40">
          {!loading && (
            <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <header className="px-4 py-3 border-b border-slate-100 bg-[#fffaf2]">
                <h3 className="text-[13px] font-semibold text-slate-800">Role</h3>
              </header>
              <div className="px-4 py-3">
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                  Team Position Title
                </label>
                <input
                  ref={positionInputRef}
                  type="text"
                  value={positionDraft}
                  onChange={(e) => setPositionDraft(e.target.value)}
                  placeholder="e.g. Backend Developer"
                  disabled={saving}
                  className="w-full text-[13px] border border-slate-200 rounded-md px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-500"
                />
              </div>
            </section>
          )}

          {loading && (
            <>
              {[0, 1, 2, 3].map((idx) => (
                <section
                  key={idx}
                  className="rounded-xl border border-slate-200 bg-white overflow-hidden animate-pulse"
                >
                  <header className="px-4 py-3 border-b border-slate-100">
                    <div className="h-3.5 w-24 rounded bg-slate-200" />
                  </header>
                  <div className="divide-y divide-slate-100">
                    {[0, 1, 2].map((row) => (
                      <div
                        key={row}
                        className="flex items-start justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="h-3 w-28 rounded bg-slate-200" />
                          <div className="h-2.5 w-44 rounded bg-slate-100" />
                        </div>
                        <div className="h-4 w-4 rounded bg-slate-200 mt-0.5" />
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading && !canEditPermissions && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Clients can edit member position, but cannot modify member permissions.
            </div>
          )}

          {!loading && permissions && canEditPermissions && (
            <>
              {allSections.map((section) => {
                const isLockedSection =
                  isConsultantMember &&
                  CONSULTANT_LOCKED_SECTIONS.includes(section.key);

                return (
                  <section
                    key={String(section.key)}
                    className="rounded-xl border border-slate-200 bg-white overflow-hidden"
                  >
                    <header className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                      <h3 className="text-[13px] font-semibold text-slate-800">
                        {section.title}
                      </h3>
                      {section.isAccessGate && (
                        <span className="flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                          <AlertTriangle className="w-3 h-3" />
                          Page visibility
                        </span>
                      )}
                    </header>
                    {section.isAccessGate && (
                      <div className="px-4 py-2 bg-amber-50/60 border-b border-amber-100">
                        <p className="text-[11px] text-amber-700">
                          Disabling a gate hides that page entirely for this member.
                        </p>
                      </div>
                    )}
                    <div className="divide-y divide-slate-100">
                      {section.items.map((item) => {
                        const group = permissions[section.key] as Record<string, boolean>;
                        const checked = isLockedSection ? true : (group[item.key] === true);
                        return (
                          <label
                            key={item.key}
                            className={`flex items-start justify-between gap-3 px-4 py-3 ${
                              isLockedSection
                                ? "opacity-80 cursor-not-allowed bg-slate-50/50"
                                : "cursor-pointer hover:bg-slate-50"
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="text-[12px] font-medium text-slate-800">
                                {item.label}
                              </p>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                {isLockedSection
                                  ? "Always enabled for consultants."
                                  : item.hint}
                              </p>
                            </div>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={isLockedSection}
                              onChange={(e) =>
                                setPermission(section.key, item.key, e.target.checked)
                              }
                              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-700 focus:ring-slate-400"
                            />
                          </label>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </>
          )}
        </div>

        <footer className="px-5 py-4 border-t border-slate-200 bg-white flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !permissions}
            className="px-3 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </footer>
      </aside>
    </div>
  );
}
