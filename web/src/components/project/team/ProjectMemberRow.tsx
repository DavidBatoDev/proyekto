import { Loader2, Pencil, Trash2 } from "lucide-react";
import { MemberDisplay } from "@/components/common/MemberDisplay";
import type { ProfileSummary } from "@/services/teams.service";

interface ProjectMemberRowProps {
  /** Profile to render. Falls back to email/initial when name is missing. */
  user: ProfileSummary | null | undefined;
  fallbackId?: string;
  /** Optional muted styling for secondary rows (e.g. team entry also direct). */
  isMuted?: boolean;
  /** Sky position chip text. Hidden if null/empty. */
  position: string | null | undefined;
  /** Slate role chip text. Always shown. */
  role: string;
  /** Optional muted right-of-name origin badge — e.g. "From Sales Team",
   * "Direct · client". Hidden when omitted (e.g. inside a team card,
   * where the parent already says where the row came from). */
  originLabel?: string | null;
  /** Multi-origin annotation chips. Each label renders as a soft slate
   * pill prefixed with "Also on" — e.g. ["Engineering Team"]. Used in
   * the Direct collaborators list to show that the same user also
   * holds team-derived shares on this project, since the data model
   * keeps both grants independently. */
  alsoOnLabels?: string[];
  /** Callbacks. Absent → button hidden. */
  onEditRole?: () => void;
  onRemove?: () => void;
  isRemoving?: boolean;
}

/**
 * One row in a team / direct-shares list on the project's Team page.
 * Renders avatar + name with [POSITION (sky)] [ROLE (slate)] chips
 * underneath, an optional origin badge, and an icon-only action group
 * (pencil = edit role, trash = remove). Mirrors the row style on
 * /teams/$teamId for consistency.
 */
export function ProjectMemberRow({
  user,
  fallbackId,
  isMuted,
  position,
  role,
  originLabel,
  alsoOnLabels,
  onEditRole,
  onRemove,
  isRemoving,
}: ProjectMemberRowProps) {
  const showActions = Boolean(onEditRole || onRemove);
  const rowClassName = isMuted
    ? "flex items-center justify-between gap-3 px-5 py-3 opacity-60"
    : "flex items-center justify-between gap-3 px-5 py-3";

  return (
    <li className={rowClassName}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <MemberDisplay
          user={user}
          fallbackId={fallbackId}
          subtitleSlot={
            <>
              {position && <PositionChip>{position}</PositionChip>}
              <RoleChip>{role}</RoleChip>
              {(alsoOnLabels ?? []).map((label) => (
                <AlsoOnChip key={label}>Also on {label}</AlsoOnChip>
              ))}
            </>
          }
        />
        {originLabel && (
          <span className="hidden shrink-0 truncate text-[11px] uppercase tracking-wide text-slate-400 sm:inline">
            {originLabel}
          </span>
        )}
      </div>
      {showActions && (
        <div className="flex shrink-0 items-center gap-1">
          {onEditRole && (
            <button
              type="button"
              onClick={onEditRole}
              aria-label="Edit role"
              title="Edit role"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              disabled={isRemoving}
              aria-label="Remove from project"
              title="Remove from project"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
            >
              {isRemoving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function PositionChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
      {children}
    </span>
  );
}

function RoleChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
      {children}
    </span>
  );
}

/**
 * Soft outlined chip used to surface multi-origin grants on the
 * Direct collaborators list. Visually quieter than the position/role
 * chips so it reads as supplementary info, not a primary tag.
 */
function AlsoOnChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-slate-500">
      {children}
    </span>
  );
}
