import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowLeft,
	CalendarClock,
	CheckCircle2,
	GitBranch,
	Link2,
	Pencil,
	Send,
	Trash2,
	Undo2,
} from "lucide-react";
import { useState } from "react";
import { AppConfirmDialog } from "@/components/common/AppConfirmDialog";
import { AppTabs } from "@/components/common/AppTabs";
import { Avatar } from "@/components/common/Avatar";
import { RoadmapNodeGlyph } from "@/components/common/NodeGlyph";
import { RequireProjectAccess } from "@/components/common/RequireProjectAccess";
import {
	CrButton,
	CrFact,
	CrSection,
	CrSkeleton,
	CrStatusDot,
} from "@/components/project/change-requests/CrPrimitives";
import { ChangeRequestDecisionModal } from "@/components/project/delivery/ChangeRequestDecisionModal";
import { ChangeRequestFormModal } from "@/components/project/delivery/ChangeRequestFormModal";
import {
	canMarkApplied,
	canWithdraw,
	canDecide as statusAllowsDecision,
	isOpen as statusIsOpen,
} from "@/components/project/delivery/changeRequestCache";
import {
	CHANGE_REQUEST_STATUS_LABEL,
	changeRequestReference,
	crLinkSegments,
	timelineImpact,
} from "@/components/project/delivery/changeRequestModel";
import { RecordAppliedModal } from "@/components/project/delivery/RecordAppliedModal";
import { ActivityFeed } from "@/components/project/logs/ActivityFeed";
import { LinkRoadmapWorkModal } from "@/components/project/roadmap-links/LinkRoadmapWorkModal";
import { useProjectActivityQuery } from "@/hooks/useActivityQueries";
import {
	useChangeRequestMutations,
	useChangeRequestQuery,
} from "@/hooks/useDeliveryQueries";
import {
	useLinkedRoadmapQuery,
	useProjectMembersQuery,
	useProjectMyPermissionsQuery,
} from "@/hooks/useProjectQueries";
import type { ChangeRequest } from "@/services/delivery.service";
import type { ProfileSummary } from "@/services/teams.service";

const TABS = ["overview", "scope", "activity"] as const;
type Tab = (typeof TABS)[number];

interface ChangeRequestSearch {
	/** Optional so links elsewhere can point here without a tab, and so the
	 *  default tab leaves the URL clean. */
	tab?: Tab;
}

export const Route = createFileRoute(
	"/_execution/project/$projectId/change-requests/$changeRequestId",
)({
	// The tab lives in the URL so a deep link lands on the right one and the back
	// button steps through them. An unknown or missing value falls back to
	// Overview rather than rendering nothing — which is also what makes adding a
	// tab later (Impact, Commercials) non-breaking.
	validateSearch: (search: Record<string, unknown>): ChangeRequestSearch => ({
		tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : undefined,
	}),
	component: ChangeRequestDetailPage,
});

function ChangeRequestDetailPage() {
	const { projectId } = Route.useParams();
	return (
		<RequireProjectAccess
			projectId={projectId}
			access="delivery"
			loadingFallback={<CrSkeleton groups={1} />}
		>
			<DetailBody />
		</RequireProjectAccess>
	);
}

function DetailBody() {
	const { projectId, changeRequestId } = Route.useParams();
	const navigate = useNavigate();
	const query = useChangeRequestQuery(projectId, changeRequestId);
	const permissions = useProjectMyPermissionsQuery(projectId);
	const mutations = useChangeRequestMutations(projectId);
	const linkedRoadmap = useLinkedRoadmapQuery(projectId);

	const { tab = "overview" } = Route.useSearch();
	const [isEditing, setIsEditing] = useState(false);
	const [isDeciding, setIsDeciding] = useState(false);
	const [isApplying, setIsApplying] = useState(false);
	const [isLinking, setIsLinking] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [isWithdrawing, setIsWithdrawing] = useState(false);

	if (query.isPending) return <CrSkeleton groups={1} />;

	const request = query.data;
	if (!request) {
		return (
			<div className="app-shell-bg flex h-full items-center justify-center">
				<p className="text-sm text-muted-foreground">
					This change request no longer exists.
				</p>
			</div>
		);
	}

	const canCreate = permissions.data?.change_requests?.create === true;
	const canDecide = permissions.data?.change_requests?.decide === true;

	const busy =
		mutations.submit.isPending ||
		mutations.decide.isPending ||
		mutations.update.isPending ||
		mutations.markApplied.isPending;

	const links = request.links ?? [];
	const roadmapId = request.roadmap_id ?? linkedRoadmap.data?.id ?? null;

	return (
		<div className="app-shell-bg h-full w-full overflow-y-auto">
			{/* A register entry's masthead: the reference reads as an identifier and
			    the verbs sit on their own line, so the page opens with what this IS
			    rather than with a toolbar. */}
			<header className="border-b border-border px-6 pb-4 pt-3.5 md:px-10">
				<Link
					to="/project/$projectId/change-requests"
					params={{ projectId }}
					className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
				>
					<ArrowLeft className="h-3 w-3" />
					Change Requests
				</Link>
				<div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
					<div className="min-w-0">
						<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
							<span className="font-mono text-xs text-muted-foreground">
								{changeRequestReference(request)}
							</span>
							<h1 className="text-xl font-semibold tracking-tight text-foreground">
								{request.title}
							</h1>
						</div>
						<div className="mt-1.5">
							<CrStatusDot
								status={request.status}
								label={CHANGE_REQUEST_STATUS_LABEL[request.status]}
							/>
						</div>
					</div>

					{/* Only the verbs this status actually permits — mirrors the backend
					    guards, so a button never offers a write the server refuses. */}
					<div className="flex shrink-0 flex-wrap items-center gap-2">
						{statusAllowsDecision(request) && canDecide && (
							<CrButton
								tone="primary"
								onClick={() => setIsDeciding(true)}
								disabled={busy}
							>
								<CheckCircle2 className="h-3.5 w-3.5" />
								Decide
							</CrButton>
						)}
						{canMarkApplied(request) && canDecide && (
							<CrButton
								tone="primary"
								onClick={() => setIsApplying(true)}
								disabled={busy}
							>
								<GitBranch className="h-3.5 w-3.5" />
								Apply to roadmap
							</CrButton>
						)}
						{statusIsOpen(request) && canCreate && (
							<>
								<CrButton
									tone="primary"
									onClick={() => mutations.submit.mutate(request.id)}
									disabled={busy}
								>
									<Send className="h-3.5 w-3.5" />
									Submit for decision
								</CrButton>
								<CrButton onClick={() => setIsEditing(true)} disabled={busy}>
									<Pencil className="h-3.5 w-3.5" />
									Edit
								</CrButton>
							</>
						)}
						{canWithdraw(request) && canCreate && (
							<CrButton onClick={() => setIsWithdrawing(true)} disabled={busy}>
								<Undo2 className="h-3.5 w-3.5" />
								Withdraw
							</CrButton>
						)}
						{canDecide && (
							<CrButton
								tone="danger"
								onClick={() => setIsDeleting(true)}
								disabled={mutations.remove.isPending}
							>
								<Trash2 className="h-3.5 w-3.5" />
								Delete
							</CrButton>
						)}
					</div>
				</div>
			</header>

			<div className="w-full px-6 py-7 md:px-10 md:py-9">
				{/* The impact banner: what this request costs, stated once, above the
				    tabs so it is visible whichever tab is open. This is the number the
				    whole page exists to communicate. */}
				<ImpactBanner request={request} />

				<AppTabs
					items={[
						{ key: "overview", label: "Overview" },
						{ key: "scope", label: "Scope", count: links.length },
						{ key: "activity", label: "Activity" },
					]}
					active={tab}
					// Router mode: each tab is a real link, so it can be shared,
					// bookmarked and reached with the back button.
					linkFor={(key) => ({
						to: "/project/$projectId/change-requests/$changeRequestId",
						params: { projectId, changeRequestId },
						// Overview is the default, so it clears the param instead of
						// stamping ?tab=overview onto every share of the page.
						search: { tab: key === "overview" ? undefined : key },
					})}
					variant="underline"
					className="mb-5"
				/>

				{tab === "overview" && (
					<OverviewTab projectId={projectId} request={request} />
				)}

				{tab === "scope" && (
					<ScopeTab
						request={request}
						canEdit={statusIsOpen(request) && canCreate}
						busy={mutations.removeLink.isPending}
						onOpenLinkPicker={() => setIsLinking(true)}
						onUnlink={(linkId) =>
							mutations.removeLink.mutate({ id: request.id, linkId })
						}
					/>
				)}

				{tab === "activity" && (
					<ActivityTab
						projectId={projectId}
						changeRequestId={changeRequestId}
					/>
				)}
			</div>

			{isEditing && (
				<ChangeRequestFormModal
					isOpen
					request={request}
					pending={mutations.update.isPending}
					onClose={() => setIsEditing(false)}
					onCreate={() => {
						/* edit-only here */
					}}
					onUpdate={(body) => {
						mutations.update.mutate({ id: request.id, body });
						setIsEditing(false);
					}}
				/>
			)}

			{isDeciding && (
				<ChangeRequestDecisionModal
					isOpen
					request={request}
					pending={mutations.decide.isPending}
					onClose={() => setIsDeciding(false)}
					onDecide={(decision, note) => {
						mutations.decide.mutate({
							id: request.id,
							body: { decision, decision_note: note },
						});
						setIsDeciding(false);
					}}
				/>
			)}

			{isApplying && (
				<RecordAppliedModal
					isOpen
					request={request}
					roadmapId={roadmapId}
					pending={mutations.markApplied.isPending}
					onClose={() => setIsApplying(false)}
					onRecord={(appliedChangeId) => {
						mutations.markApplied.mutate({ id: request.id, appliedChangeId });
						setIsApplying(false);
					}}
				/>
			)}

			{isLinking && (
				<LinkRoadmapWorkModal
					projectId={projectId}
					links={links}
					// change_request_links accepts an epic directly but has NO
					// milestone_id column.
					allowed={["epic", "feature", "task"]}
					isOpen
					title="Link affected work"
					description="What this change touches. Linking a feature covers all of its tasks."
					busy={mutations.addLink.isPending || mutations.removeLink.isPending}
					onClose={() => setIsLinking(false)}
					onLink={(target) =>
						mutations.addLink.mutate({ id: request.id, target })
					}
					onUnlink={(linkId) =>
						mutations.removeLink.mutate({ id: request.id, linkId })
					}
				/>
			)}

			<AppConfirmDialog
				open={isWithdrawing}
				title="Withdraw this change request?"
				message="It stays on the record as withdrawn, so the history of what was asked for is preserved. It can't be resubmitted."
				confirmLabel="Withdraw request"
				busy={mutations.withdraw.isPending}
				onClose={() => setIsWithdrawing(false)}
				onConfirm={() =>
					mutations.withdraw.mutate(request.id, {
						onSuccess: () => setIsWithdrawing(false),
					})
				}
			/>

			{/* Deleting erases the record of what was asked and who decided it, which
			    is exactly what a change request exists to preserve — so it asks, and
			    the copy says what is lost. */}
			<AppConfirmDialog
				open={isDeleting}
				tone="danger"
				title="Delete this change request?"
				message={`"${request.title}" and everything recorded against it — the impact, the linked work, and the decision — will be removed. Withdrawing keeps the record instead. This can't be undone.`}
				confirmLabel="Delete request"
				busy={mutations.remove.isPending}
				onClose={() => setIsDeleting(false)}
				onConfirm={() =>
					mutations.remove.mutate(request.id, {
						onSuccess: () => {
							setIsDeleting(false);
							void navigate({
								to: "/project/$projectId/change-requests",
								params: { projectId },
							});
						},
					})
				}
			/>
		</div>
	);
}

/**
 * The consequence, stated once and prominently.
 *
 * Unboxed under the top bar, matching the rhythm the deliverable detail page
 * uses for its description and progress meter.
 */
function ImpactBanner({ request }: { request: ChangeRequest }) {
	const impact = timelineImpact(request.impact_timeline_days);
	const hasDates = Boolean(
		request.target_date_before && request.target_date_after,
	);

	return (
		<div className="mb-6 border-b border-border pb-6">
			{request.description && (
				<p className="mb-5 max-w-3xl text-sm text-muted-foreground">
					{request.description}
				</p>
			)}
			<div className="flex flex-wrap items-end gap-x-12 gap-y-5">
				<div>
					<p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
						Schedule impact
					</p>
					<p className="text-4xl font-semibold tracking-tight text-foreground">
						{impact ?? (
							<span className="text-lg font-medium text-muted-foreground">
								Not estimated
							</span>
						)}
					</p>
				</div>

				{hasDates && (
					<div>
						<p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
							<CalendarClock className="h-3.5 w-3.5" />
							Target date
						</p>
						<p className="text-lg font-semibold text-foreground">
							<span className="text-muted-foreground line-through decoration-muted-foreground/50">
								{request.target_date_before}
							</span>
							<span aria-hidden className="mx-2 text-muted-foreground">
								→
							</span>
							{request.target_date_after}
						</p>
					</div>
				)}

				<div>
					<p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
						Affects
					</p>
					<p className="text-lg font-semibold text-foreground">
						{request.links?.length ?? 0}{" "}
						<span className="text-sm font-medium text-muted-foreground">
							{(request.links?.length ?? 0) === 1 ? "item" : "items"}
						</span>
					</p>
				</div>
			</div>
		</div>
	);
}

function OverviewTab({
	projectId,
	request,
}: {
	projectId: string;
	request: ChangeRequest;
}) {
	const members = useProjectMembersQuery(projectId);

	/**
	 * `ProjectMember.user` uses optional fields while `Avatar` wants a
	 * `ProfileSummary` (nullable ones), so the two are bridged here rather than
	 * widening either type for one call site.
	 */
	const profileFor = (userId: string | null): ProfileSummary | null => {
		if (!userId) return null;
		const user = members.data?.find((m) => m.user_id === userId)?.user;
		if (!user) return null;
		return {
			id: user.id,
			display_name: user.display_name ?? null,
			avatar_url: user.avatar_url ?? null,
			email: user.email ?? null,
			first_name: user.first_name ?? null,
			last_name: user.last_name ?? null,
		};
	};

	const decided = Boolean(request.decided_at);

	return (
		// One column of labelled facts, read top to bottom. The two side-by-side
		// ListBoxes this replaces were the same shape the deliverable and decision
		// detail pages used, which is most of why all three felt like one screen.
		<div className="max-w-3xl">
			<CrSection title="The request">
				<CrFact label="Raised by">
					<span className="flex min-w-0 items-center gap-2">
						<Avatar
							user={profileFor(request.requested_by)}
							fallbackId={request.requested_by ?? undefined}
							size="xs"
						/>
						<span className="truncate">
							{profileFor(request.requested_by)?.display_name ?? "Someone"}
						</span>
					</span>
				</CrFact>
				<CrFact label="Raised">
					{new Date(request.created_at).toLocaleDateString()}
				</CrFact>
				<CrFact label="What changes">
					{request.impact_scope ? (
						<span className="whitespace-pre-wrap">{request.impact_scope}</span>
					) : (
						<span className="text-muted-foreground/70">Not described.</span>
					)}
				</CrFact>
			</CrSection>

			<CrSection title="The decision">
				{!decided ? (
					<p className="text-sm text-muted-foreground/70">
						{request.status === "submitted"
							? "Waiting on a decision."
							: "Not submitted for a decision yet."}
					</p>
				) : (
					<>
						<CrFact label="Outcome">
							<CrStatusDot
								status={request.status}
								label={CHANGE_REQUEST_STATUS_LABEL[request.status]}
							/>
						</CrFact>
						<CrFact label="Decided by">
							<span className="flex min-w-0 items-center gap-2">
								<Avatar
									user={profileFor(request.decided_by)}
									fallbackId={request.decided_by ?? undefined}
									size="xs"
								/>
								<span className="truncate">
									{profileFor(request.decided_by)?.display_name ?? "Someone"}
								</span>
							</span>
						</CrFact>
						<CrFact label="On">
							{request.decided_at
								? new Date(request.decided_at).toLocaleString()
								: "—"}
						</CrFact>
						{request.decision_note && (
							<CrFact label="Note">
								<span className="whitespace-pre-wrap">
									{request.decision_note}
								</span>
							</CrFact>
						)}
					</>
				)}

				{request.status === "approved" && (
					// The thesis of the whole feature, restated where the decision is read.
					<p className="mt-3 rounded-md border border-info/30 bg-info/10 p-2.5 text-xs text-foreground">
						Approved, but not yet on the roadmap. Applying is a separate step so
						the change goes through the normal review-and-commit path and cannot
						overwrite concurrent edits.
					</p>
				)}

				{request.status === "applied" && request.applied_change && (
					<p className="mt-3 rounded-md border border-success/30 bg-success/10 p-2.5 text-xs text-foreground">
						<span className="font-semibold">On the roadmap.</span>{" "}
						{request.applied_change.semantic_change_count ??
							request.applied_change.operations_count ??
							0}{" "}
						changes committed
						{request.applied_change.committed_at
							? ` on ${new Date(request.applied_change.committed_at).toLocaleDateString()}`
							: ""}
						.
					</p>
				)}
			</CrSection>
		</div>
	);
}

function ScopeTab({
	request,
	canEdit,
	busy,
	onOpenLinkPicker,
	onUnlink,
}: {
	request: ChangeRequest;
	canEdit: boolean;
	busy: boolean;
	onOpenLinkPicker: () => void;
	onUnlink: (linkId: string) => void;
}) {
	const links = request.links ?? [];

	return (
		<div className="grid gap-4 lg:grid-cols-2">
			<CrSection
				title="Affected work"
				meta={`${links.length} linked`}
				action={
					canEdit ? (
						<button
							type="button"
							onClick={onOpenLinkPicker}
							className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
						>
							<Link2 className="h-3 w-3" />
							Link work
						</button>
					) : undefined
				}
			>
				{links.length === 0 ? (
					<p className="text-sm text-muted-foreground/70">
						Nothing linked yet. Linking the epics and features this change
						touches is what turns it from a note into a scope change.
					</p>
				) : (
					links.map((link) => {
						const segments = crLinkSegments(link);
						return (
							<div
								key={link.id}
								className="flex items-center gap-3 border-b border-border/60 py-2 text-sm last:border-b-0"
							>
								<span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
									{segments.map((segment, index) => (
										<span
											key={`${link.id}-${segment.kind}-${segment.title}`}
											className="flex items-center gap-1.5"
										>
											{index > 0 && (
												<span aria-hidden className="text-muted-foreground/50">
													/
												</span>
											)}
											<RoadmapNodeGlyph kind={segment.kind} size={12} />
											<span
												className={
													index === segments.length - 1
														? "truncate text-foreground"
														: "truncate text-muted-foreground"
												}
											>
												{segment.title}
											</span>
										</span>
									))}
									{segments.length === 0 && (
										<span className="text-muted-foreground">
											A linked item that no longer exists
										</span>
									)}
								</span>
								{canEdit && (
									<CrButton
										tone="danger"
										onClick={() => onUnlink(link.id)}
										disabled={busy}
									>
										Unlink
									</CrButton>
								)}
							</div>
						);
					})
				)}
			</CrSection>

			<CrSection title="What changes" meta="as described by whoever raised it">
				{request.impact_scope ? (
					<p className="max-w-2xl whitespace-pre-wrap text-sm leading-relaxed text-foreground">
						{request.impact_scope}
					</p>
				) : (
					<p className="text-sm text-muted-foreground/70">
						No scope description was given.
					</p>
				)}
			</CrSection>
		</div>
	);
}

function ActivityTab({
	projectId,
	changeRequestId,
}: {
	projectId: string;
	changeRequestId: string;
}) {
	const query = useProjectActivityQuery(projectId, {
		entity_type: "change_request",
		entity_id: changeRequestId,
	});

	const entries = query.data?.pages.flatMap((page) => page.items) ?? [];

	// Without this the feed renders its "no activity yet" empty state while the
	// first page is still in flight, which reads as a fact rather than a wait.
	if (query.isPending) {
		return (
			<CrSection title="History">
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
			</CrSection>
		);
	}

	return (
		<CrSection title="History">
			<ActivityFeed
				items={entries}
				hasFilters={false}
				hasNextPage={Boolean(query.hasNextPage)}
				isFetchingNextPage={query.isFetchingNextPage}
				onLoadMore={() => void query.fetchNextPage()}
				onClearFilters={() => undefined}
				canViewSensitive
			/>
		</CrSection>
	);
}
