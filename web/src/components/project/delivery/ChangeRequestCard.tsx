import { Link } from "@tanstack/react-router";
import {
	AlertTriangle,
	CalendarClock,
	CheckCircle2,
	GitBranch,
	Send,
} from "lucide-react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import type { ChangeRequest } from "@/services/delivery.service";
import { isOptimisticId } from "./changeRequestCache";
import {
	CHANGE_REQUEST_STATUS_LABEL,
	CHANGE_REQUEST_STATUS_TONE,
	changeRequestReference,
	crLinkSegments,
	timelineImpact,
} from "./changeRequestModel";
import {
	FieldLabel,
	PrimaryButton,
	RoadmapNodeGlyph,
	SecondaryButton,
	StatusPill,
} from "./DeliveryPrimitives";

/** Link rows shown on a card before the rest collapses to "+N more". */
const LINKS_PREVIEW = 3;

/**
 * The rail colour is the status, so a stack of cards is scannable without
 * reading a single pill. Amber for anything that needs a human.
 */
const STATUS_RAIL: Record<ChangeRequest["status"], string> = {
	draft: "bg-muted-foreground/30",
	submitted: "bg-warning",
	approved: "bg-info",
	applied: "bg-success",
	rejected: "bg-destructive",
	changes_requested: "bg-destructive",
	withdrawn: "bg-muted-foreground/20",
};

export interface ChangeRequestCardActions {
	canCreate: boolean;
	canDecide: boolean;
	busy: boolean;
	onSubmit: () => void;
	onOpenDecision: () => void;
	onOpenApply: () => void;
}

/**
 * The rich card: enough to answer "should I approve this?" without opening
 * anything — what is being asked for, what it does to the schedule, what it
 * touches, and who has said what.
 */
export function ChangeRequestCard({
	request,
	projectId,
	compact = false,
	actions,
}: {
	request: ChangeRequest;
	projectId: string;
	compact?: boolean;
	actions: ChangeRequestCardActions;
}) {
	const links = request.links ?? [];
	const impact = timelineImpact(request.impact_timeline_days);
	const reference = changeRequestReference(request);
	const awaiting = request.status === "submitted";
	const bounced = request.status === "changes_requested";
	const isOpen = request.status === "draft" || bounced;
	// Still being created: the row exists only in the cache, so its detail route
	// and its actions have nothing to address yet.
	const saving = isOptimisticId(request.id);

	if (compact) {
		return (
			<Link
				to="/project/$projectId/change-requests/$changeRequestId"
				params={{ projectId, changeRequestId: request.id }}
				disabled={saving}
				className={`relative block overflow-hidden rounded-xl border border-border bg-card p-3 pl-4 transition-colors hover:border-primary/40 ${
					saving ? "pointer-events-none opacity-60" : ""
				}`}
			>
				<span
					aria-hidden
					className={`absolute inset-y-0 left-0 w-1 ${STATUS_RAIL[request.status]}`}
				/>
				<div className="flex items-start justify-between gap-2">
					<span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
						{reference}
					</span>
					{bounced && (
						<AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
					)}
				</div>
				<p className="mt-0.5 line-clamp-2 text-sm font-semibold text-foreground">
					{request.title}
				</p>
				<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
					{impact && <span className="font-semibold">{impact}</span>}
					{links.length > 0 && (
						<span className="inline-flex items-center gap-1">
							<GitBranch className="h-3 w-3" />
							{links.length}
						</span>
					)}
				</div>
			</Link>
		);
	}

	return (
		// Fixed height on wide screens: a request with six links and one with none
		// produce the same row, so the list scans as a list. Overflow is clamped and
		// the detail page is where the whole of it lives.
		<AppSurfaceCard
			className={`relative overflow-hidden p-4 pl-5 transition-colors hover:border-primary/30 lg:h-[13.5rem] ${
				bounced ? "border-destructive/30" : ""
			} ${saving ? "pointer-events-none opacity-60" : ""}`}
		>
			<span
				aria-hidden
				className={`absolute inset-y-0 left-0 w-1 ${STATUS_RAIL[request.status]}`}
			/>

			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
							{reference}
						</span>
						{saving ? (
							<span className="text-sm font-semibold text-foreground">
								{request.title}
							</span>
						) : (
							<Link
								to="/project/$projectId/change-requests/$changeRequestId"
								params={{ projectId, changeRequestId: request.id }}
								className="text-sm font-semibold text-foreground hover:text-primary"
							>
								{request.title}
							</Link>
						)}
						<StatusPill
							label={CHANGE_REQUEST_STATUS_LABEL[request.status]}
							tone={CHANGE_REQUEST_STATUS_TONE[request.status]}
						/>
					</div>
					{request.description && (
						<p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
							{request.description}
						</p>
					)}
				</div>

				<div className="flex shrink-0 items-center gap-2">
					{saving && (
						<span className="text-xs text-muted-foreground">Saving…</span>
					)}
					{!saving && awaiting && actions.canDecide && (
						<PrimaryButton
							onClick={actions.onOpenDecision}
							disabled={actions.busy}
						>
							<CheckCircle2 className="h-4 w-4" />
							Decide
						</PrimaryButton>
					)}
					{!saving && request.status === "approved" && actions.canDecide && (
						<PrimaryButton
							onClick={actions.onOpenApply}
							disabled={actions.busy}
						>
							<GitBranch className="h-4 w-4" />
							Apply to roadmap
						</PrimaryButton>
					)}
					{!saving && isOpen && actions.canCreate && (
						<SecondaryButton onClick={actions.onSubmit} disabled={actions.busy}>
							<Send className="h-3.5 w-3.5" />
							Submit
						</SecondaryButton>
					)}
				</div>
			</div>

			{/* One card per row, so the body reads across in columns rather than
			    stretching one column over the full width. */}
			<div className="mt-3.5 grid items-start gap-x-8 gap-y-3 lg:grid-cols-3">
				{/* Impact — the argument the approver weighs, so it leads. */}
				<div>
					<FieldLabel>Impact</FieldLabel>
					<p className="text-2xl font-semibold tracking-tight text-foreground">
						{impact ?? (
							<span className="text-base font-medium text-muted-foreground">
								Not estimated
							</span>
						)}
					</p>
					{request.target_date_before && request.target_date_after && (
						<p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
							<CalendarClock className="h-3.5 w-3.5 shrink-0" />
							<span className="line-through decoration-muted-foreground/50">
								{request.target_date_before}
							</span>
							<span aria-hidden>→</span>
							<span className="font-semibold text-foreground">
								{request.target_date_after}
							</span>
						</p>
					)}
				</div>

				{/* What it touches — the trail that makes this more than a ticket. */}
				<div>
					<FieldLabel>Affects</FieldLabel>
					{links.length === 0 ? (
						<p className="text-xs text-muted-foreground">Nothing linked yet.</p>
					) : (
						<ul className="space-y-1">
							{links.slice(0, LINKS_PREVIEW).map((link) => {
								const segments = crLinkSegments(link);
								const leaf = segments.at(-1);
								if (!leaf) return null;
								return (
									<li
										key={link.id}
										className="flex items-center gap-1.5 text-xs text-muted-foreground"
									>
										<RoadmapNodeGlyph kind={leaf.kind} size={12} />
										<span className="truncate text-foreground">
											{leaf.title}
										</span>
									</li>
								);
							})}
							{links.length > LINKS_PREVIEW && (
								<li className="text-[11px] text-muted-foreground">
									+{links.length - LINKS_PREVIEW} more
								</li>
							)}
						</ul>
					)}
				</div>

				{/* Scope prose, plus whatever the decision said. */}
				<div>
					<FieldLabel>What changes</FieldLabel>
					<p className="line-clamp-2 text-xs text-muted-foreground">
						{request.impact_scope ?? "Not described."}
					</p>
					{request.decision_note && !awaiting && (
						<p className="mt-2 line-clamp-2 rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground">
							<span className="font-semibold text-foreground">Decision:</span>{" "}
							{request.decision_note}
						</p>
					)}
					{request.status === "approved" && !request.decision_note && (
						<p className="mt-2 text-[11px] text-info">
							Approved — not yet on the roadmap.
						</p>
					)}
					{request.status === "applied" && (
						<p className="mt-2 text-[11px] text-success">
							On the roadmap
							{request.applied_change?.semantic_change_count
								? ` · ${request.applied_change.semantic_change_count} changes`
								: ""}
							.
						</p>
					)}
				</div>
			</div>
		</AppSurfaceCard>
	);
}
