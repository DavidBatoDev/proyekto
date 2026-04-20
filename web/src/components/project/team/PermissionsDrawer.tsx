import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import type { ProjectMember, ProjectPermissions } from "@/services/project.service";
import { projectService } from "@/services/project.service";
import { memberDisplayName } from "./utils";
import { useInvalidateProjectQueries } from "@/hooks/useProjectQueries";

const permissionSections: Array<{
  key: keyof ProjectPermissions;
  title: string;
  items: Array<{ key: string; label: string; hint: string }>;
}> = [
  {
    key: "roadmap",
    title: "Roadmap",
    items: [
      {
        key: "edit",
        label: "Edit",
        hint: "Create, update, reorder, and delete roadmap items.",
      },
      {
        key: "view_internal",
        label: "View Internal",
        hint: "See internal roadmap notes and details.",
      },
      {
        key: "comment",
        label: "Comment",
        hint: "Add and manage comments on roadmap entities.",
      },
      {
        key: "promote",
        label: "Promote",
        hint: "Promote roadmap items between stages.",
      },
    ],
  },
  {
    key: "members",
    title: "Members",
    items: [
      {
        key: "manage",
        label: "Manage",
        hint: "Invite, edit, and remove team members.",
      },
      {
        key: "view",
        label: "View",
        hint: "View team member list and details.",
      },
    ],
  },
  {
    key: "project",
    title: "Project",
    items: [
      {
        key: "settings",
        label: "Settings",
        hint: "Update project-level settings.",
      },
    ],
  },
  {
    key: "time",
    title: "Time",
    items: [
      {
        key: "log",
        label: "Log Time",
        hint: "Start and stop timers and create manual time entries.",
      },
      {
        key: "edit_own",
        label: "Edit Own Logs",
        hint: "Edit your own time logs.",
      },
      {
        key: "edit_team",
        label: "Edit Team Logs",
        hint: "Edit other members' time logs.",
      },
      {
        key: "approve",
        label: "Approve Logs",
        hint: "Approve or reject submitted time entries.",
      },
      {
        key: "manage_rates",
        label: "Manage Rates",
        hint: "Configure billable rates and pricing.",
      },
      { key: "view", label: "View", hint: "View time and rate information." },
    ],
  },
];

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
  const [permissions, setPermissions] = useState<ProjectPermissions | null>(
    null,
  );
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
        const value = await projectService.getMemberPermissions(
          projectId,
          member.id,
        );
        if (!cancelled) setPermissions(value);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Failed to load permissions.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, member, projectId]);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => positionInputRef.current?.focus(), 160);
    return () => clearTimeout(id);
  }, [open]);

  const setPermission = (
    section: keyof ProjectPermissions,
    key: string,
    checked: boolean,
  ) => {
    setPermissions((prev) => {
      if (!prev) return prev;
      const group = prev[section] as Record<string, boolean>;
      return {
        ...prev,
        [section]: {
          ...group,
          [key]: checked,
        },
      } as ProjectPermissions;
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

      const updatedMember = await projectService.updateMember(
        projectId,
        member.id,
        {
          position: trimmedPosition,
        },
      );
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
                <h3 className="text-[13px] font-semibold text-slate-800">
                  Role
                </h3>
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
              {[0, 1, 2].map((idx) => (
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

          {!loading &&
            permissions &&
            canEditPermissions &&
            permissionSections.map((section) => (
              <section
                key={String(section.key)}
                className="rounded-xl border border-slate-200 bg-white overflow-hidden"
              >
                <header className="px-4 py-3 border-b border-slate-100">
                  <h3 className="text-[13px] font-semibold text-slate-800">
                    {section.title}
                  </h3>
                </header>
                <div className="divide-y divide-slate-100">
                  {section.items.map((item) => {
                    const group = permissions[section.key] as Record<
                      string,
                      boolean
                    >;
                    const isLockedConsultantTime =
                      isConsultantMember && section.key === "time";
                    const checked = isLockedConsultantTime
                      ? true
                      : group[item.key] === true;
                    return (
                      <label
                        key={item.key}
                        className={`flex items-start justify-between gap-3 px-4 py-3 ${
                          isLockedConsultantTime
                            ? "opacity-80 cursor-not-allowed bg-slate-50/50"
                            : "cursor-pointer hover:bg-slate-50"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium text-slate-800">
                            {item.label}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {isLockedConsultantTime
                              ? "Consultant time permissions are always enabled."
                              : item.hint}
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isLockedConsultantTime}
                          onChange={(e) =>
                            setPermission(
                              section.key,
                              item.key,
                              e.target.checked,
                            )
                          }
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-700 focus:ring-slate-400"
                        />
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}
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

