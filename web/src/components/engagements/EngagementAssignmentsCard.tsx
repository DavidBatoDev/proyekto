/**
 * The engagement page's Assignments section: who works on which project
 * under this agreement (ux.md › Engagement page; backend
 * `GET/POST /engagements/:id/assignments`, `POST …/:aid/end`).
 *
 * Every party reads the list. Workers are named only to provider-side
 * parties; a client hirer reads "Delivery team" (L22, the server masks it).
 * A talent engagement's hirer assigns and ends the talent's work; a client
 * engagement's consultant assigns themselves and ends work under it. After an
 * assignment whose worker still has no project access, the section keeps
 * "Ask a project admin to add Leo." on screen until dismissed (L25).
 *
 * Web only: the engagement page is a marketplace surface, hidden in the
 * installed app, and this section renders nothing there.
 */

import { Link } from "@tanstack/react-router";
import { Briefcase, Loader2, TriangleAlert, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import { isNativeApp } from "@/lib/platform";
import type { Engagement } from "@/services/engagement.service";
import type { EngagementAssignment } from "@/services/engagementAssignments.service";
import { useAuthStore } from "@/stores/authStore";
import { AssignToProjectDialog } from "./AssignToProjectDialog";
import {
	ASSIGNMENT_COPY,
	accessNeededCopy,
	assignedToast,
	assignmentAuthority,
	assignmentEmptyCopy,
	assignmentErrorCopy,
	assignmentSectionDescription,
	assignmentSpanLine,
	assignmentStatusLabel,
	assignmentWorkerName,
	sortAssignments,
} from "./assignmentCopy";
import { EndAssignmentDialog } from "./EndAssignmentDialog";
import { useEngagementAssignments } from "./useEngagementAssignments";

export interface EngagementAssignmentsCardProps {
	engagement: Engagement;
	/** "Now" for the dates' current-year rule (tests). */
	now?: Date;
}

interface AccessNotice {
	assignmentId: string;
	workerName: string;
	projectTitle: string;
}

export function EngagementAssignmentsCard({
	engagement,
	now,
}: EngagementAssignmentsCardProps) {
	const native = isNativeApp();
	const viewerId = useAuthStore((state) => state.user?.id ?? null);
	const query = useEngagementAssignments(engagement.id, {
		enabled: !native,
	});
	const [assignOpen, setAssignOpen] = useState(false);
	const [ending, setEnding] = useState<EngagementAssignment | null>(null);
	const [notice, setNotice] = useState<AccessNotice | null>(null);
	const [showPast, setShowPast] = useState(false);

	if (native) return null;

	const authority = assignmentAuthority(engagement);
	const rows = query.data ?? [];
	const { active, past } = sortAssignments(rows);

	/** The name the end dialog uses; null = the viewer's own. */
	const endWorkerName = (row: EngagementAssignment): string | null =>
		viewerId && row.worker_user_id === viewerId ? null : row.worker_label;

	return (
		<AppSurfaceCard className="p-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
						<Briefcase className="h-4 w-4 text-muted-foreground" />
						{ASSIGNMENT_COPY.sectionTitle}
					</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						{assignmentSectionDescription(engagement)}
					</p>
				</div>
				{authority.canAssign && (
					<button
						type="button"
						onClick={() => setAssignOpen(true)}
						className="app-cta inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-primary-foreground"
					>
						<UserPlus className="h-4 w-4" />
						{ASSIGNMENT_COPY.assign}
					</button>
				)}
			</div>

			{notice && (
				<div
					role="status"
					className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-foreground"
				>
					<TriangleAlert
						aria-hidden
						className="mt-0.5 h-4 w-4 shrink-0 text-warning"
					/>
					<p className="min-w-0 flex-1">
						{assignedToast(notice.workerName, notice.projectTitle)}{" "}
						<span className="font-semibold">
							{accessNeededCopy(notice.workerName)}
						</span>
					</p>
					<button
						type="button"
						onClick={() => setNotice(null)}
						aria-label={ASSIGNMENT_COPY.dismiss}
						className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
			)}

			<div className="mt-4">
				{query.isPending ? (
					<div className="flex justify-center py-6">
						<Loader2
							className="h-5 w-5 animate-spin text-primary"
							aria-label={ASSIGNMENT_COPY.loadingLabel}
						/>
					</div>
				) : query.isError ? (
					<p role="alert" className="text-sm text-destructive">
						{assignmentErrorCopy(query.error, { operation: "list" })}
					</p>
				) : rows.length === 0 ? (
					<p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
						{assignmentEmptyCopy(engagement)}
					</p>
				) : (
					<>
						{active.length > 0 && (
							<ul className="divide-y divide-border">
								{active.map((row) => (
									<AssignmentRow
										key={row.id}
										row={row}
										viewerId={viewerId}
										now={now}
										onEnd={authority.canEnd ? () => setEnding(row) : undefined}
									/>
								))}
							</ul>
						)}
						{past.length > 0 && (
							<div className={active.length > 0 ? "mt-3" : undefined}>
								<button
									type="button"
									onClick={() => setShowPast((open) => !open)}
									aria-expanded={showPast}
									className="text-xs font-semibold text-primary hover:underline"
								>
									{showPast
										? ASSIGNMENT_COPY.hideEnded
										: ASSIGNMENT_COPY.showEnded(past.length)}
								</button>
								{showPast && (
									<ul className="mt-2 divide-y divide-border">
										{past.map((row) => (
											<AssignmentRow
												key={row.id}
												row={row}
												viewerId={viewerId}
												now={now}
											/>
										))}
									</ul>
								)}
							</div>
						)}
					</>
				)}
			</div>

			{assignOpen && (
				<AssignToProjectDialog
					engagement={engagement}
					assignments={rows}
					onClose={() => setAssignOpen(false)}
					onAssigned={(result) => {
						setAssignOpen(false);
						// An earlier notice stays until dismissed; a new one replaces it.
						if (result.access_needed) {
							setNotice({
								assignmentId: result.id,
								workerName: authority.workerName ?? result.worker_label,
								projectTitle: result.project_title_snapshot,
							});
						}
					}}
				/>
			)}

			{ending && (
				<EndAssignmentDialog
					engagementId={engagement.id}
					assignment={ending}
					workerName={endWorkerName(ending)}
					onClose={() => setEnding(null)}
					onEnded={() => {
						if (notice?.assignmentId === ending.id) setNotice(null);
						setEnding(null);
					}}
				/>
			)}
		</AppSurfaceCard>
	);
}

function AssignmentRow({
	row,
	viewerId,
	now,
	onEnd,
}: {
	row: EngagementAssignment;
	viewerId: string | null;
	now?: Date;
	onEnd?: () => void;
}) {
	const isActive = row.status === "active";
	const details = [
		assignmentWorkerName(row, viewerId),
		row.role_title,
		assignmentSpanLine(row, { now }),
	].filter((part): part is string => Boolean(part));

	return (
		<li
			data-testid="assignment-row"
			className="flex flex-wrap items-center justify-between gap-3 py-2.5"
		>
			<div className="min-w-0">
				{row.project_id && isActive ? (
					<Link
						to="/project/$projectId/overview"
						params={{ projectId: row.project_id }}
						className="block truncate text-sm font-medium text-primary hover:underline"
					>
						{row.project_title_snapshot}
					</Link>
				) : (
					<span
						className={`block truncate text-sm font-medium ${isActive ? "text-foreground" : "text-muted-foreground"}`}
					>
						{row.project_title_snapshot}
					</span>
				)}
				<p className="truncate text-xs text-muted-foreground">
					{details.join(" · ")}
				</p>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<span
					className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
						isActive
							? "border-success/30 bg-success/10 text-success"
							: "border-border bg-muted/60 text-muted-foreground"
					}`}
				>
					{assignmentStatusLabel(row.status)}
				</span>
				{isActive && onEnd && (
					<button
						type="button"
						onClick={onEnd}
						aria-label={`${ASSIGNMENT_COPY.end}: ${row.project_title_snapshot}`}
						className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
					>
						{ASSIGNMENT_COPY.end}
					</button>
				)}
			</div>
		</li>
	);
}
