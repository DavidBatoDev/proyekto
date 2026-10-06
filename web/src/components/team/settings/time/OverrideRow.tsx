import type { ReactNode } from "react";
import { settingsButton } from "@/components/workspace/settings/SettingsPrimitives";
import { possessive } from "@/lib/timeFormat";
import { cn } from "@/lib/utils";

/**
 * One row of Team settings › Time › Team rules (ux.md › Team Override).
 *
 * A row either inherits ("Use Acme's policy (weekly · Mon · Asia/Manila)",
 * muted, with an [Override] button) or carries this team's own value
 * ("Override for this team", the editor, and "Use workspace policy" to drop
 * it). The row only lays things out: the parent owns the draft, the save and
 * the reset, and renders the editor as `children` (disabled when the viewer
 * can't change it).
 */

export const OVERRIDE_ROW_COPY = {
	override: "Override",
	overridden: "Override for this team",
	useWorkspace: "Use workspace policy",
	save: "Save",
	saving: "Saving…",
	cancel: "Cancel",
} as const;

/**
 * "Use Acme's policy (allowed)"; "Use workspace policy (allowed)" without a
 * workspace name; no parentheses when the inherited value is unknown.
 */
export function inheritedLine(
	workspaceName: string | null | undefined,
	summary: string | null | undefined,
): string {
	const name = workspaceName?.trim();
	const head = name
		? `Use ${possessive(name)} policy`
		: OVERRIDE_ROW_COPY.useWorkspace;
	return summary ? `${head} (${summary})` : head;
}

export type OverrideRowState = "inherited" | "editing" | "overridden";

export interface OverrideRowProps {
	/** Stable id stem for the label and editor group ("team-rule-period"). */
	id: string;
	/** "Timesheet period", "Manual time", … */
	label: string;
	/** The team's workspace, for "Use Acme's policy (…)". */
	workspaceName?: string | null;
	/** The inherited value in words ("weekly · Mon · Asia/Manila"); null when unknown. */
	inheritedSummary?: string | null;
	/** The team stores its own value for this row. */
	overridden: boolean;
	/** The override editor is open on a row that still inherits. */
	editing?: boolean;
	/** The viewer may change this row (plan and role allow it). */
	canEdit: boolean;
	/** The editor's draft differs from what is stored. */
	dirty?: boolean;
	/** A write for this row is in flight. */
	pending?: boolean;
	/** One line under the row: a reason, or "Applies from Mon Oct 6. …". */
	hint?: ReactNode;
	onOverride?: () => void;
	onSave?: () => void;
	onCancel?: () => void;
	onReset?: () => void;
	/** The editor: shown while editing and on an overridden row. */
	children?: ReactNode;
	className?: string;
}

const SMALL = "h-8 px-3 text-xs";

export function OverrideRow({
	id,
	label,
	workspaceName,
	inheritedSummary,
	overridden,
	editing = false,
	canEdit,
	dirty = false,
	pending = false,
	hint,
	onOverride,
	onSave,
	onCancel,
	onReset,
	children,
	className,
}: OverrideRowProps) {
	const state: OverrideRowState = overridden
		? "overridden"
		: editing
			? "editing"
			: "inherited";
	const labelId = `${id}-label`;
	const showEditor = state !== "inherited" && children != null;
	// A new override can be saved as is (pinning today's value is a choice);
	// an existing one only once it changed.
	const canSave = canEdit && !pending && (state === "editing" || dirty);
	const showDraftActions = canEdit && (state === "editing" || dirty);

	return (
		<div
			data-testid="override-row"
			data-row={id}
			data-state={state}
			className={cn("py-4 first:pt-0 last:pb-0", className)}
		>
			<div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
				<div className="min-w-0 grow basis-48">
					<div
						id={labelId}
						className={cn(
							"text-sm font-medium leading-5",
							state === "inherited"
								? "text-muted-foreground"
								: "text-foreground",
						)}
					>
						{label}
					</div>
					<div
						data-testid="override-row-state"
						className="mt-0.5 text-xs leading-relaxed text-muted-foreground"
					>
						{state === "overridden"
							? OVERRIDE_ROW_COPY.overridden
							: inheritedLine(workspaceName, inheritedSummary)}
					</div>
				</div>
				{canEdit && state === "inherited" && onOverride ? (
					<button
						type="button"
						onClick={onOverride}
						disabled={pending}
						aria-describedby={labelId}
						className={cn(settingsButton.secondary, SMALL)}
					>
						{OVERRIDE_ROW_COPY.override}
					</button>
				) : null}
				{canEdit && state === "overridden" && onReset ? (
					<button
						type="button"
						onClick={onReset}
						disabled={pending}
						aria-describedby={labelId}
						className={cn(settingsButton.secondary, SMALL)}
					>
						{OVERRIDE_ROW_COPY.useWorkspace}
					</button>
				) : null}
			</div>

			{showEditor ? (
				<fieldset
					aria-labelledby={labelId}
					className="mt-3 min-w-0 space-y-3"
					disabled={!canEdit || pending}
				>
					{children}
					{showDraftActions ? (
						<div className="flex flex-wrap items-center gap-2">
							<button
								type="button"
								onClick={onSave}
								disabled={!canSave}
								className={cn(settingsButton.primary, SMALL)}
							>
								{pending ? OVERRIDE_ROW_COPY.saving : OVERRIDE_ROW_COPY.save}
							</button>
							<button
								type="button"
								onClick={onCancel}
								disabled={pending}
								className={cn(settingsButton.secondary, SMALL)}
							>
								{OVERRIDE_ROW_COPY.cancel}
							</button>
						</div>
					) : null}
				</fieldset>
			) : null}

			{hint ? (
				<p
					data-testid="override-row-hint"
					className="mt-2 text-xs leading-relaxed text-muted-foreground"
				>
					{hint}
				</p>
			) : null}
		</div>
	);
}
