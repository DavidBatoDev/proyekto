import { Link } from "@tanstack/react-router";
import { AlertTriangle, Check, CheckCircle2, Link2, Send } from "lucide-react";
import { useState } from "react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import { Avatar } from "@/components/common/Avatar";
import type { Deliverable } from "@/services/delivery.service";
import {
	FieldLabel,
	PrimaryButton,
	ProgressMeter,
	RoadmapNodeGlyph,
	SecondaryButton,
	StatusPill,
} from "./DeliveryPrimitives";
import { isOptimisticId } from "./deliverableCache";
import {
	DELIVERABLE_STATUS_LABEL,
	DELIVERABLE_STATUS_TONE,
	linkSegments,
	signOffSummary,
} from "./deliveryModel";
import { ReviewDecisionModal } from "./ReviewDecisionModal";

/** Rows shown on a card before the rest collapses to "+N more". */
const CRITERIA_PREVIEW = 3;
const LINKS_PREVIEW = 2;
const REVIEWERS_PREVIEW = 3;

const STATUS_RAIL: Record<Deliverable["status"], string> = {
	not_started: "bg-muted-foreground/30",
	in_progress: "bg-info",
	in_review: "bg-warning",
	approved: "bg-success",
	changes_requested: "bg-destructive",
};

export interface DeliverableCardActions {
	onSubmit: () => void;
	onReview: (decision: "approved" | "changes_requested", note?: string) => void;
	onToggleCriterion: (criterionId: string, isMet: boolean) => void;
	onOpenLinkPicker: () => void;
	canEdit: boolean;
	/** True when this viewer may cast a decision on this deliverable. */
	canDecide: boolean;
	busy: boolean;
}

/**
 * The rich card. Carries enough that someone can answer "can I accept this?"
 * without opening anything: completion traced to real tasks, what the work
 * came from, the checklist that defines done, and who still owes a sign-off.
 */
export function DeliverableCard({
	deliverable,
	projectId,
	compact = false,
	actions,
}: {
	deliverable: Deliverable;
	projectId: string;
	compact?: boolean;
	actions: DeliverableCardActions;
}) {
	const [isDeciding, setIsDeciding] = useState(false);
	const progress = deliverable.progress;
	const criteria = deliverable.criteria ?? [];
	const links = deliverable.links ?? [];
	const signOff = signOffSummary(deliverable);
	// A long checklist would stretch the card past the other two columns and
	// leave a screen of dead space beside it; the rest lives on the detail page.
	const visibleCriteria = criteria.slice(0, CRITERIA_PREVIEW);
	const hiddenCriteria = criteria.length - visibleCriteria.length;
	const inReview = deliverable.status === "in_review";
	const bounced = deliverable.status === "changes_requested";
	// Still being created: the row exists only in the cache, so its detail route
	// and its actions have nothing to address yet.
	const saving = isOptimisticId(deliverable.id);

	if (compact) {
		return (
			<Link
				to="/project/$projectId/deliverables/$deliverableId"
				params={{ projectId, deliverableId: deliverable.id }}
				disabled={saving}
				className={`relative block overflow-hidden rounded-xl border border-border bg-card p-3 pl-4 transition-colors hover:border-primary/40 ${
					saving ? "pointer-events-none opacity-60" : ""
				}`}
			>
				<span
					aria-hidden
					className={`absolute inset-y-0 left-0 w-1 ${STATUS_RAIL[deliverable.status]}`}
				/>
				<div className="flex items-start justify-between gap-2">
					<p className="min-w-0 truncate text-sm font-semibold text-foreground">
						{deliverable.title}
					</p>
					{bounced && (
						<AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
					)}
				</div>
				{progress && progress.percent !== null && (
					<ProgressMeter
						percent={progress.percent}
						caption={`${progress.tasks_done}/${progress.tasks_total} tasks`}
						className="mt-2"
					/>
				)}
				{signOff && (
					<p className="mt-2 text-[11px] text-muted-foreground">
						{signOff.label}
					</p>
				)}
			</Link>
		);
	}

	return (
		// Every card in the stack is the same height regardless of what it holds:
		// a checklist of ten and a checklist of one produce the same row, so the
		// list scans as a list. Overflowing content is clamped, and the detail
		// page is where the whole of it lives.
		<AppSurfaceCard
			className={`relative overflow-hidden p-4 pl-5 transition-colors hover:border-primary/30 lg:h-[14.5rem] ${
				bounced ? "border-destructive/30" : ""
			} ${saving ? "pointer-events-none opacity-60" : ""}`}
		>
			{/* A status rail down the left edge, so a stack of cards is scannable
			    without reading every pill. */}
			<span
				aria-hidden
				className={`absolute inset-y-0 left-0 w-1 ${STATUS_RAIL[deliverable.status]}`}
			/>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						{saving ? (
							<span className="text-sm font-semibold text-foreground">
								{deliverable.title}
							</span>
						) : (
							<Link
								to="/project/$projectId/deliverables/$deliverableId"
								params={{ projectId, deliverableId: deliverable.id }}
								className="text-sm font-semibold text-foreground hover:text-primary"
							>
								{deliverable.title}
							</Link>
						)}
						<StatusPill
							label={DELIVERABLE_STATUS_LABEL[deliverable.status]}
							tone={DELIVERABLE_STATUS_TONE[deliverable.status]}
						/>
					</div>
					{deliverable.description && (
						<p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
							{deliverable.description}
						</p>
					)}
				</div>

				<div className="flex shrink-0 items-center gap-2">
					{saving && (
						<span className="text-xs text-muted-foreground">Saving…</span>
					)}
					{!saving && inReview && actions.canDecide && (
						<PrimaryButton
							onClick={() => setIsDeciding(true)}
							disabled={actions.busy}
						>
							<CheckCircle2 className="h-4 w-4" />
							Review
						</PrimaryButton>
					)}
					{!saving &&
						actions.canEdit &&
						!inReview &&
						deliverable.status !== "approved" && (
							<SecondaryButton
								onClick={actions.onSubmit}
								disabled={actions.busy}
							>
								<Send className="h-3.5 w-3.5" />
								Submit for review
							</SecondaryButton>
						)}
				</div>
			</div>

			{/* The card is one per row, so its body reads across in columns rather
			    than stretching a single column over the full width. */}
			<div className="mt-3 grid items-start gap-x-8 gap-y-3 lg:grid-cols-3">
				<div>
					{progress && (
						<ProgressMeter
							percent={progress.percent}
							caption={
								progress.tasks_total > 0
									? `${progress.tasks_done} / ${progress.tasks_total} related tasks completed`
									: criteria.length > 0
										? `${progress.criteria_met} / ${progress.criteria_total} criteria met`
										: "No work linked yet"
							}
						/>
					)}
					<div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
						{deliverable.due_date && <span>Due {deliverable.due_date}</span>}
						{deliverable.submitted_at && (
							<span>
								Submitted{" "}
								{new Date(deliverable.submitted_at).toLocaleDateString()}
							</span>
						)}
						{signOff && <span>{signOff.label}</span>}
					</div>
				</div>

				{/* Where the work came from — Roadmap → Work → Deliverable is the
				    trail that makes a deliverable more than a to-do. */}
				<div>
					<div className="mb-1.5 flex items-center justify-between">
						<FieldLabel>Related roadmap</FieldLabel>
						{actions.canEdit && (
							<button
								type="button"
								onClick={actions.onOpenLinkPicker}
								className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
							>
								<Link2 className="h-3 w-3" />
								{links.length ? "Edit links" : "Link work"}
							</button>
						)}
					</div>
					{links.length === 0 ? (
						<p className="text-xs text-muted-foreground">
							Nothing linked, so completion can't be traced to real work yet.
						</p>
					) : (
						<ul className="space-y-1">
							{links.slice(0, LINKS_PREVIEW).map((link) => {
								const segments = linkSegments(link);
								if (segments.length === 0) return null;
								// One line per link here, so it carries the leaf's glyph
								// with its ancestors as a quiet prefix.
								const leaf = segments[segments.length - 1];
								return (
									<li
										key={link.id}
										className="flex items-center gap-1.5 text-xs text-muted-foreground"
									>
										<RoadmapNodeGlyph kind={leaf.kind} size={12} />
										<span className="truncate">
											{segments.length > 1 && (
												<span className="opacity-70">
													{segments
														.slice(0, -1)
														.map((part) => part.title)
														.join(" / ")}{" "}
													/{" "}
												</span>
											)}
											<span className="text-foreground">{leaf.title}</span>
										</span>
									</li>
								);
							})}
							{links.length > LINKS_PREVIEW && (
								<li className="text-xs text-muted-foreground">
									+{links.length - LINKS_PREVIEW} more
								</li>
							)}
						</ul>
					)}
				</div>

				{criteria.length > 0 && (
					<div className="self-start rounded-lg bg-muted/40 p-3">
						<div className="mb-2 flex items-center justify-between gap-3">
							<FieldLabel>Acceptance criteria</FieldLabel>
							<span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
								{progress?.criteria_met ?? 0} / {criteria.length} met
							</span>
						</div>
						<ul className="space-y-1.5">
							{visibleCriteria.map((criterion) => (
								<li key={criterion.id} className="flex items-center gap-2">
									<button
										type="button"
										disabled={!actions.canEdit}
										onClick={() =>
											actions.onToggleCriterion(criterion.id, !criterion.is_met)
										}
										className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
											criterion.is_met
												? "border-success bg-success text-white"
												: "border-border bg-card"
										} ${actions.canEdit ? "hover:border-primary" : "cursor-default"}`}
										aria-label={criterion.is_met ? "Mark not met" : "Mark met"}
									>
										{criterion.is_met && <Check className="h-3 w-3" />}
									</button>
									<span
										className={`text-sm ${
											criterion.is_met
												? "text-muted-foreground line-through"
												: "text-foreground"
										}`}
									>
										{criterion.label}
									</span>
								</li>
							))}
						</ul>
						{hiddenCriteria > 0 && (
							<Link
								to="/project/$projectId/deliverables/$deliverableId"
								params={{ projectId, deliverableId: deliverable.id }}
								// Straight to the checklist — that's what the reader
								// clicked this for, not the detail page's Overview.
								search={{ tab: "requirements" }}
								className="mt-2 inline-block text-[11px] font-semibold text-primary hover:underline"
							>
								+{hiddenCriteria} more
							</Link>
						)}
					</div>
				)}
			</div>

			{(deliverable.reviewers ?? []).length > 0 && (
				<div className="mt-3 border-t border-border pt-2.5">
					<FieldLabel>Review &amp; approval</FieldLabel>
					<ul className="mt-1.5 grid gap-x-8 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
						{(deliverable.reviewers ?? [])
							.slice(0, REVIEWERS_PREVIEW)
							.map((reviewer) => (
								<li
									key={reviewer.id}
									className="flex items-center justify-between gap-3"
								>
									<span className="flex min-w-0 items-center gap-2">
										<Avatar
											user={reviewer.reviewer ?? null}
											fallbackId={reviewer.reviewer_id}
											size="xs"
										/>
										<span className="truncate text-sm text-foreground">
											{reviewer.reviewer?.display_name ?? "Member"}
										</span>
									</span>
									<StatusPill
										label={
											reviewer.decision === "approved"
												? "Approved"
												: reviewer.decision === "changes_requested"
													? "Changes"
													: "Pending"
										}
										tone={
											reviewer.decision === "approved"
												? "good"
												: reviewer.decision === "changes_requested"
													? "bad"
													: "neutral"
										}
									/>
								</li>
							))}
					</ul>
					{(deliverable.reviewers ?? []).length > REVIEWERS_PREVIEW && (
						<p className="mt-1.5 text-[11px] text-muted-foreground">
							+{(deliverable.reviewers ?? []).length - REVIEWERS_PREVIEW} more
							reviewer
							{(deliverable.reviewers ?? []).length - REVIEWERS_PREVIEW === 1
								? ""
								: "s"}
						</p>
					)}
				</div>
			)}

			{bounced && deliverable.review_note && (
				<p className="mt-3 line-clamp-2 rounded-lg bg-destructive/10 p-3 text-sm text-foreground">
					<span className="font-semibold">Changes requested:</span>{" "}
					{deliverable.review_note}
				</p>
			)}

			{inReview && !actions.canDecide && (
				<p className="mt-3 text-xs text-muted-foreground">
					{signOff && signOff.pending > 0
						? `Waiting on ${signOff.pending} more sign-off${signOff.pending === 1 ? "" : "s"}.`
						: "Waiting on review."}
				</p>
			)}

			<ReviewDecisionModal
				isOpen={isDeciding}
				title={deliverable.title}
				pending={actions.busy}
				onClose={() => setIsDeciding(false)}
				onDecide={(decision, note) => {
					actions.onReview(decision, note);
					setIsDeciding(false);
				}}
			/>
		</AppSurfaceCard>
	);
}
