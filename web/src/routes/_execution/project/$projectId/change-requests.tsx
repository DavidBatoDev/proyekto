import {
	createFileRoute,
	Outlet,
	useChildMatches,
	useNavigate,
} from "@tanstack/react-router";
import { GitPullRequestArrow, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { RequireProjectAccess } from "@/components/common/RequireProjectAccess";
import { ChangeRequestCard } from "@/components/project/delivery/ChangeRequestCard";
import { ChangeRequestDecisionModal } from "@/components/project/delivery/ChangeRequestDecisionModal";
import { ChangeRequestFormModal } from "@/components/project/delivery/ChangeRequestFormModal";
import { ChangeRequestHealth } from "@/components/project/delivery/ChangeRequestHealth";
import {
	CR_PIPELINE_COLUMNS,
	type CrPipelineColumnKey,
	crPipelineColumnFor,
	summarizeChangeRequests,
} from "@/components/project/delivery/changeRequestModel";
import {
	type DeliveryViewMode,
	DeliveryViewToggle,
	loadDeliveryView,
	storeDeliveryView,
} from "@/components/project/delivery/DeliveryHealth";
import {
	DeliveryEmpty,
	DeliveryPageShell,
	DeliverySkeleton,
	PrimaryButton,
} from "@/components/project/delivery/DeliveryPrimitives";
import { RecordAppliedModal } from "@/components/project/delivery/RecordAppliedModal";
import {
	useChangeRequestMutations,
	useChangeRequestsQuery,
} from "@/hooks/useDeliveryQueries";
import {
	useLinkedRoadmapQuery,
	useProjectMyPermissionsQuery,
} from "@/hooks/useProjectQueries";
import type {
	ChangeRequest,
	ChangeRequestView,
} from "@/services/delivery.service";

/** The filter chips. `all` is the default and stays out of the URL. */
const VIEWS: Array<{ key: ChangeRequestView; label: string }> = [
	{ key: "all", label: "All" },
	{ key: "open", label: "Open" },
	{ key: "awaiting_decision", label: "Awaiting decision" },
	{ key: "decided", label: "Decided" },
	{ key: "closed", label: "Closed" },
];

interface ChangeRequestsSearch {
	view?: ChangeRequestView;
}

export const Route = createFileRoute(
	"/_execution/project/$projectId/change-requests",
)({
	// The filter lives in the URL so a filtered view is shareable and the back
	// button steps through them. An unknown value drops to undefined, which reads
	// as "all".
	validateSearch: (search: Record<string, unknown>): ChangeRequestsSearch => ({
		view: VIEWS.some((v) => v.key === search.view)
			? (search.view as ChangeRequestView)
			: undefined,
	}),
	component: ChangeRequestsLayout,
});

/**
 * Layout route: the detail page renders through the outlet, so the list state
 * (view mode, open modals, filter) survives navigating into a request and back.
 */
function ChangeRequestsLayout() {
	const { projectId } = Route.useParams();
	const childMatches = useChildMatches();
	// Start the list fetch alongside the permission check rather than after it:
	// RequireProjectAccess blocks its children until permissions resolve, so a
	// query called only inside the body queues behind that round trip. Same cache
	// key as the body's call, so this is one request, not two.
	useChangeRequestsQuery(projectId);

	if (childMatches.length > 0) return <Outlet />;

	return (
		<RequireProjectAccess
			projectId={projectId}
			access="delivery"
			loadingFallback={<DeliverySkeleton />}
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
	const mutations = useChangeRequestMutations(projectId);
	const linkedRoadmap = useLinkedRoadmapQuery(projectId);

	const [isCreating, setIsCreating] = useState(false);
	const [decidingId, setDecidingId] = useState<string | null>(null);
	const [applyingId, setApplyingId] = useState<string | null>(null);
	const [mode, setMode] = useState<DeliveryViewMode>(() =>
		loadDeliveryView(projectId, "changeRequests"),
	);

	const canCreate = permissions.data?.change_requests?.create === true;
	const canDecide = permissions.data?.change_requests?.decide === true;

	const requests = useMemo(() => query.data ?? [], [query.data]);
	// Stats describe what is loaded, so a filtered view's header describes the
	// filtered set rather than silently claiming to summarise the project.
	const stats = useMemo(() => summarizeChangeRequests(requests), [requests]);

	if (query.isPending) return <DeliverySkeleton />;

	const changeMode = (next: DeliveryViewMode) => {
		setMode(next);
		storeDeliveryView(projectId, next, "changeRequests");
	};

	const setView = (next: ChangeRequestView) =>
		void navigate({
			to: "/project/$projectId/change-requests",
			params: { projectId },
			search: next === "all" ? {} : { view: next },
			replace: true,
		});

	const busy =
		mutations.submit.isPending ||
		mutations.decide.isPending ||
		mutations.markApplied.isPending;

	const actionsFor = (request: ChangeRequest) => ({
		canCreate,
		canDecide,
		busy,
		onSubmit: () => mutations.submit.mutate(request.id),
		onOpenDecision: () => setDecidingId(request.id),
		onOpenApply: () => setApplyingId(request.id),
	});

	const deciding = requests.find((r) => r.id === decidingId) ?? null;
	const applying = requests.find((r) => r.id === applyingId) ?? null;
	const isFiltered = view !== "all";

	return (
		<DeliveryPageShell
			icon={GitPullRequestArrow}
			title="Change Requests"
			subtitle="Scope changes, what they do to the schedule, and who signed off."
			action={
				<div className="flex items-center gap-3">
					<DeliveryViewToggle value={mode} onChange={changeMode} />
					{canCreate && (
						<PrimaryButton onClick={() => setIsCreating(true)}>
							<Plus className="h-4 w-4" />
							Raise a request
						</PrimaryButton>
					)}
				</div>
			}
		>
			{/* Filter chips. Rendered above the header numbers because they scope
			    them — reading the stats first and then discovering a filter was on
			    would be misleading. */}
			<div className="-mt-1 mb-6 flex flex-wrap items-center gap-1.5">
				{VIEWS.map((option) => {
					const selected = option.key === view;
					return (
						<button
							key={option.key}
							type="button"
							onClick={() => setView(option.key)}
							aria-pressed={selected}
							className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
								selected
									? "bg-primary text-white"
									: "bg-muted text-muted-foreground hover:text-foreground"
							}`}
						>
							{option.label}
						</button>
					);
				})}
			</div>

			{canCreate && (
				<ChangeRequestFormModal
					isOpen={isCreating}
					pending={mutations.create.isPending}
					onClose={() => setIsCreating(false)}
					// Closes immediately: the optimistic row is already in the list, so
					// holding the dialog open would hide the thing it created.
					onCreate={(body) => {
						mutations.create.mutate({
							...body,
							roadmap_id: body.roadmap_id ?? linkedRoadmap.data?.id,
						});
						setIsCreating(false);
					}}
					onUpdate={() => {
						/* create-only here; editing happens on the detail page */
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

			{requests.length === 0 ? (
				isFiltered ? (
					<DeliveryEmpty
						icon={GitPullRequestArrow}
						title="Nothing matches this filter"
						description="No change requests are in this state right now. Clear the filter to see the rest."
						action={
							<PrimaryButton onClick={() => setView("all")}>
								Show all requests
							</PrimaryButton>
						}
					/>
				) : (
					<DeliveryEmpty
						icon={GitPullRequestArrow}
						title="No change requests"
						description="When someone asks for work outside the agreed scope, raise it here. The request records what changes and what it does to the schedule, so 'can you just add this' stops being invisible."
						action={
							canCreate ? (
								<PrimaryButton onClick={() => setIsCreating(true)}>
									<Plus className="h-4 w-4" />
									Raise the first one
								</PrimaryButton>
							) : undefined
						}
					/>
				)
			) : (
				<>
					<ChangeRequestHealth
						stats={stats}
						requests={requests}
						projectId={projectId}
					/>

					{mode === "overview" && (
						// One card per row — the card lays its own body out in columns, so
						// the width is used rather than stretched.
						<div className="flex flex-col gap-3">
							{requests.map((request) => (
								<ChangeRequestCard
									key={request.id}
									request={request}
									projectId={projectId}
									actions={actionsFor(request)}
								/>
							))}
						</div>
					)}

					{mode === "pipeline" && (
						<PipelineView
							requests={requests}
							projectId={projectId}
							actionsFor={actionsFor}
						/>
					)}
				</>
			)}
		</DeliveryPageShell>
	);
}

/** Column accents mirror the card rails, so the board reads at a glance. */
const COLUMN_DOT: Record<CrPipelineColumnKey, string> = {
	draft: "bg-muted-foreground/50",
	submitted: "bg-warning",
	approved: "bg-info",
	applied: "bg-success",
};

/**
 * The life of a change request, left to right — not a second Kanban.
 *
 * There is no drag: moving a request is a decision with attribution, not a
 * gesture. Rejected and withdrawn requests have no column (see
 * `CR_PIPELINE_COLUMNS`); the count below the board says how many are hidden so
 * the omission is stated rather than silent.
 */
function PipelineView({
	requests,
	projectId,
	actionsFor,
}: {
	requests: ChangeRequest[];
	projectId: string;
	actionsFor: (
		request: ChangeRequest,
	) => Parameters<typeof ChangeRequestCard>[0]["actions"];
}) {
	const offBoard = requests.filter(
		(r) => crPipelineColumnFor(r.status) === null,
	).length;

	return (
		<>
			<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
				{CR_PIPELINE_COLUMNS.map((column) => {
					const items = requests.filter(
						(r) => crPipelineColumnFor(r.status) === column.key,
					);
					return (
						<div
							key={column.key}
							className="rounded-xl border border-border/60 bg-muted/30 p-3"
						>
							<div className="mb-3 flex items-center justify-between border-b border-border/60 pb-2">
								<p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
									<span
										className={`h-1.5 w-1.5 rounded-full ${COLUMN_DOT[column.key]}`}
									/>
									{column.label}
								</p>
								<span className="rounded-full bg-card px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
									{items.length}
								</span>
							</div>
							<div className="flex flex-col gap-2">
								{items.map((request) => (
									<ChangeRequestCard
										key={request.id}
										request={request}
										projectId={projectId}
										compact
										actions={actionsFor(request)}
									/>
								))}
								{items.length === 0 && (
									<p className="px-1 py-3 text-xs text-muted-foreground">
										Nothing here.
									</p>
								)}
							</div>
						</div>
					);
				})}
			</div>
			{offBoard > 0 && (
				<p className="mt-3 text-[11px] text-muted-foreground">
					{offBoard} rejected or withdrawn{" "}
					{offBoard === 1 ? "request is" : "requests are"} not shown on the
					board.
				</p>
			)}
		</>
	);
}
