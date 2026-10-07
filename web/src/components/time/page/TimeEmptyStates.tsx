// web/src/components/time/page/TimeEmptyStates.tsx
//
// What the Time page says when there is nothing to list (ux.md › Personas,
// "Empty state and notes"). The page never shows an empty week:
//
// | Persona                          | Copy                                                                      |
// |----------------------------------|---------------------------------------------------------------------------|
// | P1 / P1b, any logger (default)   | "No time logged this week." + "Start a timer, or add time you've already worked." |
// | No project in this workspace     | "Nothing to log time on in <workspace> yet." + "Time is logged on this workspace's projects." |
// | P5 / P7 approvers                | the same week and empty state (one layout; approver_mode is not read)      |
// | P6 talent with nothing to log on | "When you're placed on a project, you'll be able to log time for it here." |
//
// `pickTimeEmptyState(overview)` chooses one from `GET /time/me/overview`;
// the page renders it with `<TimeEmptyState {...picked} />`, inside the
// entries table's `empty` slot or in place of the Waiting list.

import { CalendarCheck, Clock, Inbox, SearchX } from "lucide-react";
import type { ReactNode } from "react";
import { nativeSafe } from "@/lib/timeErrors";
import { cn } from "@/lib/utils";
import type { TimeOverview } from "@/services/time.types";

export type TimeEmptyKind =
	/** A logger with nothing in view (P1, P1b, and the default). */
	| "start"
	/** The open workspace has no project to log on. */
	| "no_projects"
	/** Approver mode with nothing waiting (P5, P7). */
	| "caught_up"
	/** Nobody can log yet (P6: talent not placed on a project). */
	| "placed"
	/** Filters (For, project, a day) leave nothing to show. */
	| "filtered";

/** Every sentence this file renders. */
export const TIME_EMPTY_COPY = {
	start: "No time logged this week",
	startHint:
		"Start a timer when you begin work, or add time you already spent.",
	noProjects: (workspace: string) =>
		`Nothing to log time on in ${workspace} yet.`,
	noProjectsHint: "Time is logged on this workspace's projects.",
	createProject: "Create a project",
	askOwner: "Ask a workspace owner to add you to a project.",
	caughtUp: "You're all caught up.",
	caughtUpHint: "Timesheets sent to you will show up here.",
	placed:
		"When you're placed on a project, you'll be able to log time for it here.",
	/** Not in ux.md: the For / project / day filters match nothing. */
	filtered: "No time entries match this view.",
	startTimer: "Start timer",
	addTime: "Add time",
} as const;

export interface TimeEmptyPick {
	kind: TimeEmptyKind;
	/** `no_projects`: the workspace's name. */
	label?: string;
	/** `caught_up`: add "Timesheets sent to you will show up here." */
	hint?: boolean;
}

/**
 * The empty state the overview calls for.
 *
 * - No `time.log` anywhere → the "placed on a project" line (P6).
 * - `filtered` → the filter line.
 * - (The old P3 line, "You log time for <label>.", is gone: under the
 *   switcher it could name another workspace.)
 *   (a member with no recent time).
 * - Otherwise → "No time logged this week." with the Start timer / Add
 *   time hint (P1, and approvers: the page has one layout).
 */
export function pickTimeEmptyState(
	overview: Pick<
		TimeOverview,
		"approver_mode" | "can_log" | "contexts" | "workspace_time_admin"
	> | null,
	options: { filtered?: boolean } = {},
): TimeEmptyPick {
	if (overview && !overview.can_log) return { kind: "placed" };
	if (options.filtered) return { kind: "filtered" };
	// "You log time for <label>" is gone: the overview's single context could
	// be another workspace's, which read wrong under the switcher.
	return { kind: "start" };
}

const ICON = {
	start: Clock,
	caught_up: CalendarCheck,
	placed: Inbox,
	no_projects: Inbox,
	filtered: SearchX,
} as const;

export interface TimeEmptyStateProps extends TimeEmptyPick {
	/** Adds a "Start timer" button (logger kinds only). */
	onStartTimer?: () => void;
	/** Adds an "Add time" button (logger kinds only). */
	onAddTime?: () => void;
	/** Replaces the default buttons. */
	action?: ReactNode;
	/**
	 * `card` (default): a dashed card for an empty list. `inline`: one muted
	 * line, for a section that already has a heading (approver mode's top line).
	 */
	variant?: "card" | "inline";
	className?: string;
}

/** The sentence(s) for a pick: `[title, detail?]`. */
export function timeEmptyText(pick: TimeEmptyPick): {
	title: string;
	detail: string | null;
} {
	switch (pick.kind) {
		case "caught_up":
			return {
				title: TIME_EMPTY_COPY.caughtUp,
				detail: pick.hint === false ? null : TIME_EMPTY_COPY.caughtUpHint,
			};
		case "no_projects":
			return {
				title: TIME_EMPTY_COPY.noProjects(
					pick.label?.trim() || "this workspace",
				),
				detail: TIME_EMPTY_COPY.noProjectsHint,
			};
		case "placed":
			return { title: TIME_EMPTY_COPY.placed, detail: null };
		case "filtered":
			return { title: TIME_EMPTY_COPY.filtered, detail: null };
		default:
			return {
				title: TIME_EMPTY_COPY.start,
				detail: TIME_EMPTY_COPY.startHint,
			};
	}
}

const BUTTON =
	"inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

export function TimeEmptyState({
	kind,
	label,
	hint,
	onStartTimer,
	onAddTime,
	action,
	variant = "card",
	className,
}: TimeEmptyStateProps) {
	const text = timeEmptyText({ kind, label, hint });
	// A team name is the only server text here; keep the native rules on it.
	const title = nativeSafe(text.title);
	const logger = kind === "start";
	const buttons =
		action ??
		(logger && (onStartTimer || onAddTime) ? (
			<>
				{onStartTimer ? (
					<button
						type="button"
						onClick={onStartTimer}
						className={cn(
							BUTTON,
							"border-transparent bg-primary text-primary-foreground hover:bg-primary/90",
						)}
					>
						{TIME_EMPTY_COPY.startTimer}
					</button>
				) : null}
				{onAddTime ? (
					<button
						type="button"
						onClick={onAddTime}
						className={cn(
							BUTTON,
							"border-border bg-background text-foreground hover:bg-muted",
						)}
					>
						{TIME_EMPTY_COPY.addTime}
					</button>
				) : null}
			</>
		) : null);

	if (variant === "inline") {
		return (
			<div
				role="status"
				data-empty={kind}
				className={cn("text-sm text-muted-foreground", className)}
			>
				<p className="font-medium text-foreground">{title}</p>
				{text.detail ? <p className="mt-0.5">{text.detail}</p> : null}
				{buttons ? (
					<div className="mt-3 flex flex-wrap items-center gap-2">
						{buttons}
					</div>
				) : null}
			</div>
		);
	}

	const Icon = ICON[kind] ?? Clock;
	return (
		<div
			role="status"
			data-empty={kind}
			className={cn(
				"rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center text-card-foreground",
				className,
			)}
		>
			<div
				aria-hidden="true"
				className="mx-auto mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground"
			>
				<Icon className="h-5 w-5" />
			</div>
			<p className="mx-auto max-w-md text-sm font-medium text-foreground">
				{title}
			</p>
			{text.detail ? (
				<p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
					{text.detail}
				</p>
			) : null}
			{buttons ? (
				<div className="mt-5 flex flex-wrap items-center justify-center gap-2">
					{buttons}
				</div>
			) : null}
		</div>
	);
}
