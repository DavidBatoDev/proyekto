import {
	createFileRoute,
	Outlet,
	useChildMatches,
	useNavigate,
} from "@tanstack/react-router";
import { GitBranch, GitPullRequestArrow, Hourglass, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { AppConfirmDialog } from "@/components/common/AppConfirmDialog";
import { RequireProjectAccess } from "@/components/common/RequireProjectAccess";
import { CrDrawer } from "@/components/project/change-requests/CrDrawer";
import {
	CrButton,
	CrEmpty,
	CrLedgerFigure,
	CrPageShell,
	CrSkeleton,
} from "@/components/project/change-requests/CrPrimitives";
import { CrQueue } from "@/components/project/change-requests/CrQueue";
import {
	groupForStatus,
	queueGroups,
	scheduleLedger,
} from "@/components/project/change-requests/crQueueModel";
import { ChangeRequestDecisionModal } from "@/components/project/delivery/ChangeRequestDecisionModal";
import { ChangeRequestFormModal } from "@/components/project/delivery/ChangeRequestFormModal";
import { RecordAppliedModal } from "@/components/project/delivery/RecordAppliedModal";
import {
	useChangeRequestMutations,
	useChangeRequestsQuery,
} from "@/hooks/useDeliveryQueries";
import {
	useLinkedRoadmapQuery,
	useProjectMembersQuery,
	useProjectMyPermissionsQuery,
} from "@/hooks/useProjectQueries";
import type {
	ChangeRequest,
	ChangeRequestView,
} from "@/services/delivery.service";
import { profilesByUserId } from "@/services/memberProfile";

/** Views that can be deep-linked. `all` is the default and stays out of the URL. */
const VIEWS: ChangeRequestView[] = [
	"all",
	"open",
	"awaiting_decision",
	"decided",
	"closed",
];

interface ChangeRequestsSearch {
	view?: ChangeRequestView;
}

export const Route = createFileRoute(
	"/_execution/project/$projectId/change-requests",
)({
	// Kept from the previous design: the filter lives in the URL so a narrowed view
	// is shareable. The queue shows every group at once, so this is now a way to
	// arrive focused rather than the primary control.
	validateSearch: (search: Record<string, unknown>): ChangeRequestsSearch => ({
		view: VIEWS.includes(search.view as ChangeRequestView)
			? (search.view as ChangeRequestView)
			: undefined,
	}),
	component: ChangeRequestsLayout,
});

/**
 * Layout route: the detail page renders through the outlet, so the queue's state
 * (open groups, drawer, modals) survives navigating into a request and back.
 */
function ChangeRequestsLayout() {
	const { projectId } = Route.useParams();
	const childMatches = useChildMatches();
	// Start the list fetch alongside the permission check rather than after it:
	// RequireProjectAccess blocks its children until permissions resolve.
	useChangeRequestsQuery(projectId);

	if (childMatches.length > 0) return <Outlet />;

	return (
		<RequireProjectAccess
			projectId={projectId}
			access="delivery"
			loadingFallback={<CrSkeleton />}
		>
			<ChangeRequestsBody projectId={projectId} />
		</RequireProjectAccess>
	);
}

function ChangeRequestsBody({ projectId }: { projectId: string }) {
	const { view = "all" } = Route.useSearch();
	const navigate = useNavigate();
	const query = useChangeRequestsQuery(projectId, { view });
	const permissions = useProjectMyPermissionsQuery(projectId);
	const members = useProjectMembersQuery(projectId);
	const mutations = useChangeRequestMutations(projectId);
	const linkedRoadmap = useLinkedRoadmapQuery(projectId);

	const [isCreating, setIsCreating] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [decidingId, setDecidingId] = useState<string | null>(null);
	const [applyingId, setApplyingId] = useState<string | null>(null);
	const [peekId, setPeekId] = useState<string | null>(null);
	const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
	const [deletingId, setDeletingId] = useState<string | null>(null);

	const canCreate = permissions.data?.change_requests?.create === true;
	const canDecide = permissions.data?.change_requests?.decide === true;

	const requests = useMemo(() => query.data ?? [], [query.data]);
	const groups = useMemo(() => queueGroups(requests), [requests]);
	// Two figures, never summed — an applied request's days are already inside the
	// roadmap's own dates.
	const ledger = useMemo(() => scheduleLedger(requests), [requests]);

	/** Members indexed so a row can show who raised a request without a lookup. */
	const profiles = useMemo(
		() => profilesByUserId(members.data),
		[members.data],
	);

	if (query.isPending) return <CrSkeleton />;

	const find = (id: string | null) =>
		id ? (requests.find((request) => request.id === id) ?? null) : null;

	const busy =
		mutations.submit.isPending ||
		mutations.decide.isPending ||
		mutations.markApplied.isPending ||
		mutations.withdraw.isPending ||
		mutations.remove.isPending;

	const handlers = {
		canCreate,
		canDecide,
		busy,
		requesterFor: (request: ChangeRequest) =>
			request.requested_by
				? (profiles.get(request.requested_by) ?? null)
				: null,
		onOpen: (request: ChangeRequest) => setPeekId(request.id),
		onSubmit: (request: ChangeRequest) => mutations.submit.mutate(request.id),
		onDecide: (request: ChangeRequest) => setDecidingId(request.id),
		onApply: (request: ChangeRequest) => setApplyingId(request.id),
		onWithdraw: (request: ChangeRequest) => setWithdrawingId(request.id),
		onEdit: (request: ChangeRequest) => setEditingId(request.id),
		onDelete: (request: ChangeRequest) => setDeletingId(request.id),
	};

	const editing = find(editingId);
	const deciding = find(decidingId);
	const applying = find(applyingId);
	const withdrawing = find(withdrawingId);
	const deleting = find(deletingId);

	return (
		<CrPageShell
			title="Change Requests"
			subtitle="Scope changes, what they do to the schedule, and who signed off."
			ledger={
				requests.length > 0 ? (
					<div className="flex items-center gap-2">
						<CrLedgerFigure
							value={signed(ledger.pending)}
							label="Pending"
							icon={Hourglass}
							// Sign-aware, not merely non-zero: a negative pending total means
							// the approved work pulls the schedule IN, which is good news and
							// should not be dressed in the same warning amber as a slip.
							// Zero stays grey — nothing waiting, nothing to draw the eye.
							tone={
								ledger.pending === 0
									? "neutral"
									: ledger.pending > 0
										? "pending"
										: "committed"
							}
							hint="Approved but not yet applied — what is about to land on the schedule"
						/>
						<CrLedgerFigure
							value={signed(ledger.committed)}
							label="Committed"
							icon={GitBranch}
							tone={
								ledger.committed === 0
									? "neutral"
									: ledger.committed > 0
										? "pending"
										: "committed"
							}
							hint="Already on the roadmap. Never add this to Pending; the roadmap's dates already include it"
						/>
					</div>
				) : undefined
			}
			action={
				canCreate ? (
					<CrButton tone="primary" onClick={() => setIsCreating(true)}>
						<Plus className="h-3.5 w-3.5" />
						Raise a request
					</CrButton>
				) : undefined
			}
		>
			{view !== "all" && (
				<div className="mb-4 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
					<span>
						Showing only{" "}
						<strong className="text-foreground">
							{view.replace(/_/g, " ")}
						</strong>
						.
					</span>
					<button
						type="button"
						className="font-semibold text-primary hover:underline"
						onClick={() =>
							void navigate({
								to: "/project/$projectId/change-requests",
								params: { projectId },
								search: {},
								replace: true,
							})
						}
					>
						Show everything
					</button>
				</div>
			)}

			{canCreate && (
				<ChangeRequestFormModal
					isOpen={isCreating || Boolean(editing)}
					request={editing ?? undefined}
					pending={mutations.create.isPending || mutations.update.isPending}
					onClose={() => {
						setIsCreating(false);
						setEditingId(null);
					}}
					// Closes immediately: the optimistic row is already in the queue, so
					// holding the dialog open would hide the thing it created.
					onCreate={(body) => {
						mutations.create.mutate({
							...body,
							roadmap_id: body.roadmap_id ?? linkedRoadmap.data?.id,
						});
						setIsCreating(false);
					}}
					onUpdate={(body) => {
						if (editing) mutations.update.mutate({ id: editing.id, body });
						setEditingId(null);
					}}
				/>
			)}

			{deciding && canDecide && (
				<ChangeRequestDecisionModal
					isOpen
					request={deciding}
					pending={mutations.decide.isPending}
					onClose={() => setDecidingId(null)}
					onDecide={(decision, note) => {
						mutations.decide.mutate({
							id: deciding.id,
							body: { decision, decision_note: note },
						});
						setDecidingId(null);
					}}
				/>
			)}

			{applying && canDecide && (
				<RecordAppliedModal
					isOpen
					request={applying}
					roadmapId={applying.roadmap_id ?? linkedRoadmap.data?.id ?? null}
					pending={mutations.markApplied.isPending}
					onClose={() => setApplyingId(null)}
					onRecord={(appliedChangeId) => {
						mutations.markApplied.mutate({
							id: applying.id,
							appliedChangeId,
						});
						setApplyingId(null);
					}}
				/>
			)}

			<CrDrawer
				request={find(peekId)}
				projectId={projectId}
				requester={
					find(peekId)?.requested_by
						? (profiles.get(find(peekId)?.requested_by as string) ?? null)
						: null
				}
				decider={
					find(peekId)?.decided_by
						? (profiles.get(find(peekId)?.decided_by as string) ?? null)
						: null
				}
				onClose={() => setPeekId(null)}
			/>

			<AppConfirmDialog
				open={Boolean(withdrawing)}
				title="Withdraw this request?"
				message={`"${withdrawing?.title}" stops waiting on anyone. It stays on the record as withdrawn rather than being deleted.`}
				confirmLabel="Withdraw"
				busy={mutations.withdraw.isPending}
				onClose={() => setWithdrawingId(null)}
				onConfirm={() => {
					if (withdrawing) mutations.withdraw.mutate(withdrawing.id);
					setWithdrawingId(null);
				}}
			/>

			<AppConfirmDialog
				open={Boolean(deleting)}
				tone="danger"
				title="Delete this request?"
				message={`"${deleting?.title}" and its links will be removed. Withdrawing keeps the record instead.`}
				confirmLabel="Delete request"
				busy={mutations.remove.isPending}
				onClose={() => setDeletingId(null)}
				onConfirm={() => {
					if (deleting) mutations.remove.mutate(deleting.id);
					setDeletingId(null);
				}}
			/>

			{requests.length === 0 ? (
				<CrEmpty
					icon={GitPullRequestArrow}
					title={
						view === "all"
							? "No change requests"
							: "Nothing matches this filter"
					}
					description={
						view === "all"
							? "When someone asks for work outside the agreed scope, raise it here. The request records what changes and what it does to the schedule, so “can you just add this” stops being invisible."
							: "No requests are in this state right now."
					}
					action={
						canCreate && view === "all" ? (
							<CrButton tone="primary" onClick={() => setIsCreating(true)}>
								<Plus className="h-3.5 w-3.5" />
								Raise the first one
							</CrButton>
						) : undefined
					}
				/>
			) : (
				<CrQueue groups={groups} projectId={projectId} handlers={handlers} />
			)}
		</CrPageShell>
	);
}

/** "+12d" / "-3d" / "0d" — the sign is the meaning, so it is never dropped. */
function signed(days: number): string {
	if (days === 0) return "0d";
	return days > 0 ? `+${days}d` : `${days}d`;
}

/** Re-exported for the detail route's back-link target checks. */
export { groupForStatus };
