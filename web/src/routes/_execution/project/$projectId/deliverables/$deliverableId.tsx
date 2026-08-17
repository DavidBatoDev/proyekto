import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowLeft,
	ExternalLink,
	Link2,
	Plus,
	Send,
	Trash2,
	UserPlus,
	X,
} from "lucide-react";
import { useState } from "react";
import { AppConfirmDialog } from "@/components/common/AppConfirmDialog";
import { AppTabs } from "@/components/common/AppTabs";
import { Avatar } from "@/components/common/Avatar";
import { RequireProjectAccess } from "@/components/common/RequireProjectAccess";
import {
	AddEvidenceModal,
	EVIDENCE_LABELS,
} from "@/components/project/delivery/AddEvidenceModal";
import { AddReviewerModal } from "@/components/project/delivery/AddReviewerModal";
import {
	DeliverySkeleton,
	FieldError,
	FieldLabel,
	inputClassFor,
	ListBox,
	ListEmpty,
	ListRow,
	PrimaryButton,
	ProgressMeter,
	RoadmapNodeGlyph,
	SecondaryButton,
	StatusPill,
} from "@/components/project/delivery/DeliveryPrimitives";
import {
	CRITERION_MAX,
	validateCriterionLabel,
} from "@/components/project/delivery/deliverableForm";
import {
	DELIVERABLE_STATUS_LABEL,
	DELIVERABLE_STATUS_TONE,
	linkSegments,
	signOffSummary,
} from "@/components/project/delivery/deliveryModel";
import { ActivityFeed } from "@/components/project/logs/ActivityFeed";
import { LinkRoadmapWorkModal } from "@/components/project/roadmap-links/LinkRoadmapWorkModal";
import { useProjectActivityQuery } from "@/hooks/useActivityQueries";
import {
	useDeliverableMutations,
	useDeliverableQuery,
} from "@/hooks/useDeliveryQueries";
import {
	useProjectMembersQuery,
	useProjectMyPermissionsQuery,
} from "@/hooks/useProjectQueries";
import type {
	Deliverable,
	EvidenceCategory,
} from "@/services/delivery.service";
import type { ProfileSummary } from "@/services/teams.service";
import { useUser } from "@/stores/authStore";

const TABS = ["overview", "requirements", "evidence", "activity"] as const;
type Tab = (typeof TABS)[number];

interface DeliverableSearch {
	/** Optional so links elsewhere can point at this route without a tab, and
	 *  so the default tab leaves the URL clean. */
	tab?: Tab;
}

export const Route = createFileRoute(
	"/_execution/project/$projectId/deliverables/$deliverableId",
)({
	// The tab lives in the URL so a deep link lands on the right one and the
	// back button steps through them. An unknown or missing value falls back to
	// Overview rather than rendering nothing.
	validateSearch: (search: Record<string, unknown>): DeliverableSearch => ({
		// An unknown value drops to undefined, which reads as Overview — the
		// same shape the other project routes use for optional search params.
		tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : undefined,
	}),
	component: DeliverableDetailPage,
});

function DeliverableDetailPage() {
	const { projectId } = Route.useParams();
	return (
		<RequireProjectAccess
			projectId={projectId}
			access="delivery"
			loadingFallback={<DeliverySkeleton rows={1} />}
		>
			<DetailBody />
		</RequireProjectAccess>
	);
}

function DetailBody() {
	const { projectId, deliverableId } = Route.useParams();
	const navigate = useNavigate();
	const query = useDeliverableQuery(projectId, deliverableId);
	const permissions = useProjectMyPermissionsQuery(projectId);
	const mutations = useDeliverableMutations(projectId);
	const user = useUser();

	const { tab = "overview" } = Route.useSearch();
	const [isLinking, setIsLinking] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);

	if (query.isPending) return <DeliverySkeleton rows={1} />;

	const deliverable = query.data;
	if (!deliverable) {
		return (
			<div className="app-shell-bg flex h-full items-center justify-center">
				<p className="text-sm text-muted-foreground">
					This deliverable no longer exists.
				</p>
			</div>
		);
	}

	const canEdit = permissions.data?.deliverables?.edit === true;
	const canApprove = permissions.data?.deliverables?.approve === true;
	const reviewers = deliverable.reviewers ?? [];
	const canDecide =
		reviewers.length === 0
			? canApprove
			: canApprove || reviewers.some((r) => r.reviewer_id === user?.id);

	const busy =
		mutations.submit.isPending ||
		mutations.review.isPending ||
		mutations.updateCriterion.isPending ||
		mutations.addCriterion.isPending;

	return (
		<div className="app-shell-bg h-full w-full overflow-y-auto">
			{/* Same top bar as the list page: page chrome running edge to edge,
			    holding its ground while the tabs scroll under it. */}
			<header className="sticky top-0 z-10 border-b border-border bg-card/90 px-6 py-3.5 backdrop-blur md:px-10">
				<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
					<div className="min-w-0">
						<Link
							to="/project/$projectId/deliverables"
							params={{ projectId }}
							className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
						>
							<ArrowLeft className="h-3 w-3" />
							Deliverables
						</Link>
						<div className="flex flex-wrap items-center gap-2">
							<h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
								{deliverable.title}
							</h1>
							<StatusPill
								label={DELIVERABLE_STATUS_LABEL[deliverable.status]}
								tone={DELIVERABLE_STATUS_TONE[deliverable.status]}
							/>
						</div>
					</div>

					<div className="flex shrink-0 items-center gap-2">
						{canEdit &&
							deliverable.status !== "in_review" &&
							deliverable.status !== "approved" && (
								<PrimaryButton
									onClick={() => mutations.submit.mutate(deliverable.id)}
									disabled={busy}
								>
									<Send className="h-4 w-4" />
									Submit for review
								</PrimaryButton>
							)}
						{canEdit && (
							<SecondaryButton
								tone="danger"
								onClick={() => setIsDeleting(true)}
								disabled={mutations.remove.isPending}
							>
								<Trash2 className="h-3.5 w-3.5" />
								Delete
							</SecondaryButton>
						)}
					</div>
				</div>
			</header>

			{/* Deleting takes the criteria, evidence, links and sign-off history
			    with it, so it asks first. */}
			<AppConfirmDialog
				open={isDeleting}
				tone="danger"
				title="Delete this deliverable?"
				message={`"${deliverable.title}" and everything recorded against it — acceptance criteria, evidence, roadmap links and sign-offs — will be removed. This can't be undone.`}
				confirmLabel="Delete deliverable"
				busy={mutations.remove.isPending}
				onClose={() => setIsDeleting(false)}
				onConfirm={() =>
					mutations.remove.mutate(deliverable.id, {
						onSuccess: () => {
							setIsDeleting(false);
							navigate({
								to: "/project/$projectId/deliverables",
								params: { projectId },
							});
						},
					})
				}
			/>

			<div className="w-full px-6 py-7 md:px-10 md:py-9">
				{/* Description and completion sit unboxed under the bar, the same
				    rhythm as the health strip on the list page. */}
				{(deliverable.description || deliverable.progress) && (
					<div className="mb-6 border-b border-border pb-5">
						{deliverable.description && (
							<p className="max-w-3xl text-sm text-muted-foreground">
								{deliverable.description}
							</p>
						)}
						{deliverable.progress && (
							<ProgressMeter
								percent={deliverable.progress.percent}
								caption={
									deliverable.progress.tasks_total > 0
										? `${deliverable.progress.tasks_done} / ${deliverable.progress.tasks_total} related tasks completed`
										: "No work linked yet"
								}
								className={`max-w-md ${deliverable.description ? "mt-4" : ""}`}
							/>
						)}
					</div>
				)}

				<AppTabs
					items={[
						{ key: "overview", label: "Overview" },
						{
							key: "requirements",
							label: "Requirements",
							count: deliverable.criteria?.length,
						},
						{
							key: "evidence",
							label: "Evidence",
							count: deliverable.attachments?.length,
						},
						{ key: "activity", label: "Activity" },
					]}
					active={tab}
					// Router mode: each tab is a real link, so it can be shared,
					// bookmarked and reached with the back button.
					linkFor={(key) => ({
						to: "/project/$projectId/deliverables/$deliverableId",
						params: { projectId, deliverableId },
						// Overview is the default, so it clears the param instead of
						// stamping ?tab=overview onto every share of the page.
						search: { tab: key === "overview" ? undefined : key },
					})}
					variant="underline"
					className="mb-5"
				/>

				{tab === "overview" && (
					<OverviewTab
						deliverable={deliverable}
						projectId={projectId}
						canEdit={canEdit}
						canDecide={canDecide}
						busy={busy}
						onOpenLinkPicker={() => setIsLinking(true)}
						onReview={(decision, note) =>
							mutations.review.mutate({
								id: deliverable.id,
								body: { decision, review_note: note },
							})
						}
						onAddReviewer={(reviewerId, profile) =>
							mutations.addReviewer.mutate({
								id: deliverable.id,
								reviewerId,
								profile,
							})
						}
						onRemoveReviewer={(reviewerId) =>
							mutations.removeReviewer.mutate({
								id: deliverable.id,
								reviewerId,
							})
						}
					/>
				)}

				{tab === "requirements" && (
					<RequirementsTab
						deliverable={deliverable}
						canEdit={canEdit}
						busy={busy}
						onAdd={(label) =>
							mutations.addCriterion.mutate({ id: deliverable.id, label })
						}
						onToggle={(criterionId, isMet) =>
							mutations.updateCriterion.mutate({
								id: deliverable.id,
								criterionId,
								body: { is_met: isMet },
							})
						}
						onRemove={(criterionId) =>
							mutations.removeCriterion.mutate({
								id: deliverable.id,
								criterionId,
							})
						}
					/>
				)}

				{tab === "evidence" && (
					<EvidenceTab
						deliverable={deliverable}
						canEdit={canEdit}
						busy={mutations.addEvidence.isPending}
						onAdd={(body) =>
							mutations.addEvidence.mutate({ id: deliverable.id, body })
						}
						onRemove={(attachmentId) =>
							mutations.removeEvidence.mutate({
								id: deliverable.id,
								attachmentId,
							})
						}
					/>
				)}

				{tab === "activity" && (
					<ActivityTab projectId={projectId} deliverableId={deliverable.id} />
				)}

				{isLinking && (
					<LinkRoadmapWorkModal
						projectId={projectId}
						links={deliverable.links ?? []}
						// deliverable_links has no epic_id or deliverable_id column.
						allowed={["feature", "task", "milestone"]}
						isOpen
						busy={mutations.addLink.isPending || mutations.removeLink.isPending}
						onClose={() => setIsLinking(false)}
						onLink={(target) =>
							mutations.addLink.mutate({ id: deliverable.id, target })
						}
						onUnlink={(linkId) =>
							mutations.removeLink.mutate({ id: deliverable.id, linkId })
						}
					/>
				)}
			</div>
		</div>
	);
}

function OverviewTab({
	deliverable,
	projectId,
	canEdit,
	canDecide,
	busy,
	onOpenLinkPicker,
	onReview,
	onAddReviewer,
	onRemoveReviewer,
}: {
	deliverable: Deliverable;
	projectId: string;
	canEdit: boolean;
	canDecide: boolean;
	busy: boolean;
	onOpenLinkPicker: () => void;
	onReview: (decision: "approved" | "changes_requested", note?: string) => void;
	onAddReviewer: (reviewerId: string, profile: ProfileSummary | null) => void;
	onRemoveReviewer: (reviewerId: string) => void;
}) {
	const members = useProjectMembersQuery(projectId);
	const [note, setNote] = useState("");
	const [isAddingReviewer, setIsAddingReviewer] = useState(false);
	const [decisionError, setDecisionError] = useState<string | null>(null);

	const reviewers = deliverable.reviewers ?? [];
	const links = deliverable.links ?? [];
	const signOff = signOffSummary(deliverable);
	const reviewerIds = new Set(reviewers.map((r) => r.reviewer_id));
	// user_id is nullable on ProjectMember (a pending email invite has none),
	// and such a member cannot be a reviewer.
	const candidates = (members.data ?? []).filter(
		(member) => member.user_id && !reviewerIds.has(member.user_id),
	);

	return (
		<div className="grid gap-4 lg:grid-cols-2">
			<ListBox
				bodyClassName="min-h-[13rem]"
				title="Related roadmap"
				meta={links.length > 0 ? `${links.length} linked` : undefined}
				action={
					canEdit ? (
						<SecondaryButton onClick={onOpenLinkPicker}>
							<Link2 className="h-3.5 w-3.5" />
							{links.length ? "Edit links" : "Link work"}
						</SecondaryButton>
					) : undefined
				}
			>
				{links.length === 0 ? (
					<ListEmpty>
						Nothing linked yet, so completion can't be traced to real work.
					</ListEmpty>
				) : (
					links.map((link) => {
						const segments = linkSegments(link);
						if (segments.length === 0) return null;
						return (
							<ListRow key={link.id} className="items-stretch py-2.5">
								<ul className="min-w-0 flex-1 space-y-0.5">
									{segments.map((segment, depth) => {
										const leaf = depth === segments.length - 1;
										return (
											<li
												key={`${segment.kind}-${segment.title}`}
												className="flex items-center gap-1.5"
												style={{ paddingLeft: `${depth * 14}px` }}
											>
												{/* Box-drawing connector, so the hierarchy is legible
												    at a glance rather than parsed out of separators. */}
												{depth > 0 && (
													<span
														aria-hidden
														className="select-none font-mono text-xs leading-none text-border"
													>
														└─
													</span>
												)}
												<RoadmapNodeGlyph kind={segment.kind} />
												<span
													className={`truncate ${
														leaf
															? "font-medium text-foreground"
															: "text-xs text-muted-foreground"
													}`}
												>
													{segment.title}
												</span>
											</li>
										);
									})}
								</ul>
								<span className="ml-auto shrink-0 self-center text-[11px] uppercase tracking-wide text-muted-foreground">
									{segments[segments.length - 1].kind}
								</span>
							</ListRow>
						);
					})
				)}
			</ListBox>

			<ListBox
				bodyClassName="min-h-[13rem]"
				title="Review & approval"
				meta={signOff?.label}
				action={
					canEdit ? (
						<SecondaryButton onClick={() => setIsAddingReviewer(true)}>
							<UserPlus className="h-3.5 w-3.5" />
							Add reviewer
						</SecondaryButton>
					) : undefined
				}
			>
				{reviewers.length === 0 ? (
					<ListEmpty>
						Nobody is named, so anyone who can approve deliverables may accept
						this one.
					</ListEmpty>
				) : (
					reviewers.map((reviewer) => (
						<ListRow key={reviewer.id}>
							<Avatar
								user={reviewer.reviewer ?? null}
								fallbackId={reviewer.reviewer_id}
								size="sm"
							/>
							<span className="min-w-0">
								<span className="block truncate text-sm text-foreground">
									{reviewer.reviewer?.display_name ?? "Member"}
								</span>
								{reviewer.note && (
									<span className="block truncate text-[11px] text-muted-foreground">
										{reviewer.note}
									</span>
								)}
							</span>
							<span className="ml-auto flex shrink-0 items-center gap-1.5">
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
								{canEdit && (
									<button
										type="button"
										onClick={() => onRemoveReviewer(reviewer.reviewer_id)}
										className="rounded p-0.5 text-muted-foreground hover:text-destructive"
										aria-label="Remove reviewer"
									>
										<X className="h-3.5 w-3.5" />
									</button>
								)}
							</span>
						</ListRow>
					))
				)}

				{canEdit && (
					<>
						<AddReviewerModal
							isOpen={isAddingReviewer}
							members={candidates}
							pending={false}
							onClose={() => setIsAddingReviewer(false)}
							onAdd={onAddReviewer}
						/>
					</>
				)}

				{deliverable.status === "in_review" && canDecide && (
					<div className="border-t border-border bg-muted/20 px-4 py-3">
						<FieldLabel>Your decision</FieldLabel>
						<textarea
							value={note}
							onChange={(event) => {
								setNote(event.target.value);
								if (decisionError) setDecisionError(null);
							}}
							rows={2}
							className={inputClassFor(decisionError)}
							aria-invalid={Boolean(decisionError)}
							placeholder="What needs to change, or why you're accepting it."
						/>
						<FieldError>{decisionError}</FieldError>
						<div className="mt-3 flex items-center gap-2">
							<PrimaryButton
								onClick={() => onReview("approved", note.trim() || undefined)}
								loading={busy}
							>
								Approve
							</PrimaryButton>
							<SecondaryButton
								// Bouncing work back without saying why leaves the owner
								// guessing, so the note is required on this path only.
								onClick={() => {
									if (!note.trim()) {
										setDecisionError(
											"Say what needs to change before requesting changes.",
										);
										return;
									}
									onReview("changes_requested", note.trim());
								}}
								disabled={busy}
							>
								Request changes
							</SecondaryButton>
						</div>
					</div>
				)}
			</ListBox>
		</div>
	);
}

function RequirementsTab({
	deliverable,
	canEdit,
	busy,
	onAdd,
	onToggle,
	onRemove,
}: {
	deliverable: Deliverable;
	canEdit: boolean;
	busy: boolean;
	onAdd: (label: string) => void;
	onToggle: (criterionId: string, isMet: boolean) => void;
	onRemove: (criterionId: string) => void;
}) {
	const [label, setLabel] = useState("");
	const [error, setError] = useState<string | null>(null);
	const criteria = deliverable.criteria ?? [];
	const met = criteria.filter((c) => c.is_met).length;

	return (
		<ListBox
			bodyClassName="min-h-[16rem]"
			title="Acceptance criteria"
			meta={`${met} / ${criteria.length} met`}
		>
			{criteria.length === 0 ? (
				<ListEmpty>
					No criteria yet. These are what someone checks against before
					accepting the work.
				</ListEmpty>
			) : (
				criteria.map((criterion) => (
					<ListRow key={criterion.id}>
						<label className="flex min-w-0 flex-1 items-center gap-2.5">
							<input
								type="checkbox"
								checked={criterion.is_met}
								disabled={!canEdit}
								onChange={(event) =>
									onToggle(criterion.id, event.target.checked)
								}
								className="h-4 w-4 shrink-0 accent-primary"
							/>
							<span
								className={
									criterion.is_met
										? "truncate text-muted-foreground line-through"
										: "truncate text-foreground"
								}
							>
								{criterion.label}
							</span>
						</label>
						{canEdit && (
							<button
								type="button"
								onClick={() => onRemove(criterion.id)}
								className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
								aria-label="Remove criterion"
							>
								<X className="h-3.5 w-3.5" />
							</button>
						)}
					</ListRow>
				))
			)}

			{canEdit && (
				<form
					className="border-t border-border bg-muted/20 px-4 py-3"
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						const problem = validateCriterionLabel(
							label,
							criteria.map((c) => c.label),
						);
						setError(problem);
						if (problem) return;
						onAdd(label.trim());
						setLabel("");
					}}
				>
					<div className="flex items-center gap-2">
						<input
							value={label}
							maxLength={CRITERION_MAX + 1}
							onChange={(event) => {
								setLabel(event.target.value);
								if (error) setError(null);
							}}
							className={inputClassFor(error)}
							aria-invalid={Boolean(error)}
							aria-label="New acceptance criterion"
							placeholder="Add a criterion"
						/>
						<PrimaryButton type="submit" loading={busy}>
							<Plus className="h-4 w-4" />
							Add
						</PrimaryButton>
					</div>
					<FieldError>{error}</FieldError>
				</form>
			)}
		</ListBox>
	);
}

function EvidenceTab({
	deliverable,
	canEdit,
	busy,
	onAdd,
	onRemove,
}: {
	deliverable: Deliverable;
	canEdit: boolean;
	busy: boolean;
	onAdd: (body: {
		kind: "link";
		url: string;
		category: EvidenceCategory;
		label?: string;
	}) => void;
	onRemove: (attachmentId: string) => void;
}) {
	const [isAdding, setIsAdding] = useState(false);
	const attachments = deliverable.attachments ?? [];

	return (
		<ListBox
			bodyClassName="min-h-[16rem]"
			title="Evidence"
			meta={
				attachments.length > 0 ? `${attachments.length} attached` : undefined
			}
			action={
				canEdit ? (
					<SecondaryButton onClick={() => setIsAdding(true)}>
						<Plus className="h-3.5 w-3.5" />
						Attach
					</SecondaryButton>
				) : undefined
			}
		>
			{attachments.length === 0 ? (
				<ListEmpty>
					Proof the work is done — a pull request, a design file, a deployment.
					"Done" on its own isn't reviewable.
				</ListEmpty>
			) : (
				attachments.map((attachment) => (
					<ListRow key={attachment.id}>
						<StatusPill
							label={EVIDENCE_LABELS[attachment.category] ?? "Other"}
							tone="neutral"
						/>
						<a
							href={attachment.url}
							target="_blank"
							rel="noreferrer noopener"
							className="inline-flex min-w-0 items-center gap-1 truncate text-primary hover:underline"
						>
							<span className="truncate">
								{attachment.label ?? attachment.url}
							</span>
							<ExternalLink className="h-3 w-3 shrink-0" />
						</a>
						{canEdit && (
							<button
								type="button"
								onClick={() => onRemove(attachment.id)}
								className="ml-auto shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
								aria-label="Remove evidence"
							>
								<X className="h-3.5 w-3.5" />
							</button>
						)}
					</ListRow>
				))
			)}

			{canEdit && (
				<AddEvidenceModal
					isOpen={isAdding}
					pending={busy}
					onClose={() => setIsAdding(false)}
					onSubmit={(body) => {
						onAdd(body);
						setIsAdding(false);
					}}
				/>
			)}
		</ListBox>
	);
}

/**
 * Reuses the project activity feed, filtered to this deliverable. No new
 * backend: the activity API already accepts entity_type and entity_id.
 */
function ActivityTab({
	projectId,
	deliverableId,
}: {
	projectId: string;
	deliverableId: string;
}) {
	const query = useProjectActivityQuery(projectId, {
		entity_type: "deliverable",
		entity_id: deliverableId,
	});

	const entries = query.data?.pages.flatMap((page) => page.items) ?? [];

	// Without this the feed renders its "no activity yet" empty state while the
	// first page is still in flight, which reads as a fact rather than a wait.
	if (query.isPending) {
		return (
			<ListBox title="Activity" bodyClassName="min-h-[16rem] p-4">
				<div className="animate-pulse space-y-3">
					{["a", "b", "c", "d"].map((key) => (
						<div key={key} className="flex items-start gap-3">
							<div className="h-7 w-7 shrink-0 rounded-full bg-muted" />
							<div className="min-w-0 flex-1 space-y-1.5">
								<div className="h-3 w-2/3 rounded bg-muted" />
								<div className="h-2.5 w-24 rounded bg-muted/70" />
							</div>
						</div>
					))}
				</div>
			</ListBox>
		);
	}

	return (
		<ListBox title="Activity" bodyClassName="min-h-[16rem] p-4">
			<ActivityFeed
				items={entries}
				hasFilters={false}
				hasNextPage={Boolean(query.hasNextPage)}
				isFetchingNextPage={query.isFetchingNextPage}
				onLoadMore={() => void query.fetchNextPage()}
				onClearFilters={() => undefined}
				canViewSensitive
			/>
		</ListBox>
	);
}
