import {
	createFileRoute,
	Outlet,
	useChildMatches,
} from "@tanstack/react-router";
import { Package, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { RequireProjectAccess } from "@/components/common/RequireProjectAccess";
import { CreateDeliverableModal } from "@/components/project/delivery/CreateDeliverableModal";
import { DeliverableCard } from "@/components/project/delivery/DeliverableCard";
import {
	DeliveryHealth,
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
import {
	PIPELINE_COLUMNS,
	type PipelineColumnKey,
	pipelineColumnFor,
	summarize,
} from "@/components/project/delivery/deliveryModel";
import { LinkRoadmapWorkModal } from "@/components/project/roadmap-links/LinkRoadmapWorkModal";
import {
	useDeliverableMutations,
	useDeliverablesQuery,
} from "@/hooks/useDeliveryQueries";
import { useProjectMyPermissionsQuery } from "@/hooks/useProjectQueries";
import type { Deliverable } from "@/services/delivery.service";
import { useUser } from "@/stores/authStore";

export const Route = createFileRoute(
	"/_execution/project/$projectId/deliverables",
)({
	component: DeliverablesLayout,
});

/**
 * Layout route: the detail page renders through the outlet, so the list state
 * (view mode, open modals) survives navigating into a deliverable and back.
 */
function DeliverablesLayout() {
	const { projectId } = Route.useParams();
	const childMatches = useChildMatches();
	// Start the list fetch alongside the permission check rather than after it:
	// RequireProjectAccess blocks its children until permissions resolve.
	useDeliverablesQuery(projectId);

	if (childMatches.length > 0) return <Outlet />;

	return (
		<RequireProjectAccess
			projectId={projectId}
			access="delivery"
			loadingFallback={<DeliverySkeleton />}
		>
			<DeliverablesBody projectId={projectId} />
		</RequireProjectAccess>
	);
}

function DeliverablesBody({ projectId }: { projectId: string }) {
	const query = useDeliverablesQuery(projectId);
	const permissions = useProjectMyPermissionsQuery(projectId);
	const mutations = useDeliverableMutations(projectId);
	const user = useUser();

	const [isCreating, setIsCreating] = useState(false);
	const [linkingId, setLinkingId] = useState<string | null>(null);
	const [view, setView] = useState<DeliveryViewMode>(() =>
		loadDeliveryView(projectId),
	);

	const canEdit = permissions.data?.deliverables?.edit === true;
	const canApprove = permissions.data?.deliverables?.approve === true;

	const deliverables = useMemo(() => query.data ?? [], [query.data]);
	const stats = useMemo(() => summarize(deliverables), [deliverables]);

	if (query.isPending) return <DeliverySkeleton />;

	const changeView = (mode: DeliveryViewMode) => {
		setView(mode);
		storeDeliveryView(projectId, mode);
	};

	const busy =
		mutations.submit.isPending ||
		mutations.review.isPending ||
		mutations.updateCriterion.isPending;

	// Being named a reviewer is itself the grant to decide, so this must not
	// reduce to the blanket approve permission.
	const canDecideOn = (deliverable: Deliverable) => {
		const reviewers = deliverable.reviewers ?? [];
		if (reviewers.length === 0) return canApprove;
		return canApprove || reviewers.some((r) => r.reviewer_id === user?.id);
	};

	const actionsFor = (deliverable: Deliverable) => ({
		canEdit,
		canDecide: canDecideOn(deliverable),
		busy,
		onSubmit: () => mutations.submit.mutate(deliverable.id),
		onReview: (decision: "approved" | "changes_requested", note?: string) =>
			mutations.review.mutate({
				id: deliverable.id,
				body: { decision, review_note: note },
			}),
		onToggleCriterion: (criterionId: string, isMet: boolean) =>
			mutations.updateCriterion.mutate({
				id: deliverable.id,
				criterionId,
				body: { is_met: isMet },
			}),
		onOpenLinkPicker: () => setLinkingId(deliverable.id),
	});

	const linking = deliverables.find((d) => d.id === linkingId) ?? null;

	return (
		<DeliveryPageShell
			icon={Package}
			title="Deliverables"
			subtitle="Track project outputs, review submissions, and record acceptance."
			action={
				<div className="flex items-center gap-3">
					<DeliveryViewToggle value={view} onChange={changeView} />
					{canEdit && (
						<PrimaryButton onClick={() => setIsCreating(true)}>
							<Plus className="h-4 w-4" />
							New deliverable
						</PrimaryButton>
					)}
				</div>
			}
		>
			{deliverables.length > 0 && (
				<p className="-mt-2 mb-5 text-xs text-muted-foreground">
					{stats.total} deliverable{stats.total === 1 ? "" : "s"} ·{" "}
					{stats.accepted} accepted · {stats.inReview} in review ·{" "}
					{stats.inProgress} in progress
				</p>
			)}

			{canEdit && (
				<CreateDeliverableModal
					isOpen={isCreating}
					pending={mutations.create.isPending}
					onClose={() => setIsCreating(false)}
					// Closes immediately: the optimistic card is already in the list,
					// so holding the dialog open would hide the thing it created.
					onSubmit={(body) => {
						mutations.create.mutate(body);
						setIsCreating(false);
					}}
				/>
			)}

			{deliverables.length === 0 ? (
				<DeliveryEmpty
					icon={Package}
					title="No deliverables yet"
					description="A deliverable is something the project hands over and someone accepts — a design, a build, a deployment. Link the roadmap work that produces it and give reviewers somewhere to sign off."
					action={
						canEdit ? (
							<PrimaryButton onClick={() => setIsCreating(true)}>
								<Plus className="h-4 w-4" />
								Add the first one
							</PrimaryButton>
						) : undefined
					}
				/>
			) : (
				<>
					<DeliveryHealth stats={stats} deliverables={deliverables} />

					{view === "overview" && (
						// One card per row — the card lays its own body out in columns,
						// so the width is used rather than stretched.
						<div className="flex flex-col gap-3">
							{deliverables.map((deliverable) => (
								<DeliverableCard
									key={deliverable.id}
									deliverable={deliverable}
									projectId={projectId}
									actions={actionsFor(deliverable)}
								/>
							))}
						</div>
					)}

					{view === "pipeline" && (
						<PipelineView
							deliverables={deliverables}
							projectId={projectId}
							actionsFor={actionsFor}
						/>
					)}
				</>
			)}

			{linking && (
				<LinkRoadmapWorkModal
					projectId={projectId}
					links={linking.links ?? []}
					// deliverable_links has no epic_id or deliverable_id column.
					allowed={["feature", "task", "milestone"]}
					isOpen
					busy={mutations.addLink.isPending || mutations.removeLink.isPending}
					onClose={() => setLinkingId(null)}
					onLink={(target) =>
						mutations.addLink.mutate({ id: linking.id, target })
					}
					onUnlink={(linkId) =>
						mutations.removeLink.mutate({ id: linking.id, linkId })
					}
				/>
			)}
		</DeliveryPageShell>
	);
}

/** Column accents mirror the status tones so the board reads at a glance. */
const COLUMN_DOT: Record<PipelineColumnKey, string> = {
	not_started: "bg-muted-foreground/50",
	in_progress: "bg-info",
	in_review: "bg-warning",
	approved: "bg-success",
};

/**
 * Production → Review → Acceptance, not a second Kanban.
 *
 * Columns mirror the stored status exactly and there is no drag: moving a
 * deliverable is a review decision with attribution, not a gesture.
 */
function PipelineView({
	deliverables,
	projectId,
	actionsFor,
}: {
	deliverables: Deliverable[];
	projectId: string;
	actionsFor: (d: Deliverable) => ReturnType<typeof Object> & {
		canEdit: boolean;
		canDecide: boolean;
		busy: boolean;
		onSubmit: () => void;
		onReview: (
			decision: "approved" | "changes_requested",
			note?: string,
		) => void;
		onToggleCriterion: (criterionId: string, isMet: boolean) => void;
		onOpenLinkPicker: () => void;
	};
}) {
	return (
		<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
			{PIPELINE_COLUMNS.map((column) => {
				const items = deliverables.filter(
					(d) => pipelineColumnFor(d.status) === column.key,
				);
				return (
					<div
						key={column.key}
						className="rounded-xl border border-border/60 bg-muted/30 p-3"
					>
						<div className="mb-3 flex items-center justify-between border-b border-border/60 pb-2">
							<p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
								<span
									className={`h-1.5 w-1.5 rounded-full ${COLUMN_DOT[column.key] ?? "bg-muted-foreground"}`}
								/>
								{column.label}
							</p>
							<span className="rounded-full bg-card px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
								{items.length}
							</span>
						</div>
						<div className="flex flex-col gap-2">
							{items.map((deliverable) => (
								<DeliverableCard
									key={deliverable.id}
									deliverable={deliverable}
									projectId={projectId}
									compact
									actions={actionsFor(deliverable)}
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
	);
}
