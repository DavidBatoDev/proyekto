import {
	createFileRoute,
	Outlet,
	useChildMatches,
} from "@tanstack/react-router";
import { Gavel, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { RequireProjectAccess } from "@/components/common/RequireProjectAccess";
import { CreateDecisionModal } from "@/components/project/delivery/CreateDecisionModal";
import { DecisionCard } from "@/components/project/delivery/DecisionCard";
import {
	type CategoryFilter,
	CategoryFilterRow,
	DecisionHealth,
} from "@/components/project/delivery/DecisionHealth";
import {
	DeliveryEmpty,
	DeliveryPageShell,
	DeliverySkeleton,
	PrimaryButton,
} from "@/components/project/delivery/DeliveryPrimitives";
import { summarizeDecisions } from "@/components/project/delivery/decisionModel";
import { ManageCategoriesModal } from "@/components/project/delivery/ManageCategoriesModal";
import {
	useDecisionCategoriesQuery,
	useDecisionCategoryMutations,
	useDecisionMutations,
	useDecisionsQuery,
} from "@/hooks/useDeliveryQueries";
import { useProjectMyPermissionsQuery } from "@/hooks/useProjectQueries";
import type { Decision, DecisionCategory } from "@/services/delivery.service";

export const Route = createFileRoute(
	"/_execution/project/$projectId/decisions",
)({ component: DecisionsLayout });

/**
 * Layout route: the detail page renders through the outlet, so the list state
 * (category filter, open modals) survives navigating into a decision and back.
 */
function DecisionsLayout() {
	const { projectId } = Route.useParams();
	const childMatches = useChildMatches();
	// Start the list fetch alongside the permission check rather than after it:
	// RequireProjectAccess blocks its children until permissions resolve.
	useDecisionsQuery(projectId);

	if (childMatches.length > 0) return <Outlet />;

	return (
		<RequireProjectAccess
			projectId={projectId}
			access="delivery"
			loadingFallback={<DeliverySkeleton />}
		>
			<DecisionsBody projectId={projectId} />
		</RequireProjectAccess>
	);
}

function DecisionsBody({ projectId }: { projectId: string }) {
	const query = useDecisionsQuery(projectId);
	const categoriesQuery = useDecisionCategoriesQuery(projectId);
	const permissions = useProjectMyPermissionsQuery(projectId);
	const mutations = useDecisionMutations(projectId);
	const categoryMutations = useDecisionCategoryMutations(projectId);

	const [isCreating, setIsCreating] = useState(false);
	const [supersedes, setSupersedes] = useState<string | null>(null);
	const [managingCategories, setManagingCategories] = useState(false);
	const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(null);

	const canEdit = permissions.data?.decisions?.edit === true;

	const decisions = useMemo(() => query.data ?? [], [query.data]);
	const categories = useMemo(
		() => categoriesQuery.data ?? [],
		[categoriesQuery.data],
	);
	const stats = useMemo(() => summarizeDecisions(decisions), [decisions]);

	// Filtering client-side rather than refetching per chip: the whole list is
	// already cached, and a round trip per click would make the counts feel like
	// they lag the selection.
	const visible = useMemo(() => {
		if (categoryFilter === null) return decisions;
		if (categoryFilter === "") return decisions.filter((d) => !d.category_id);
		return decisions.filter((d) => d.category_id === categoryFilter);
	}, [decisions, categoryFilter]);

	const decisionCounts = useMemo(() => {
		const counts: Record<string, number> = {};
		for (const decision of decisions) {
			if (decision.category_id) {
				counts[decision.category_id] = (counts[decision.category_id] ?? 0) + 1;
			}
		}
		return counts;
	}, [decisions]);

	if (query.isPending) return <DeliverySkeleton />;

	const openForm = (supersedeId?: string) => {
		setSupersedes(supersedeId ?? null);
		setIsCreating(true);
	};

	const busy = mutations.finalize.isPending || mutations.create.isPending;

	/** Resolves with the created row so the combobox can select it at once. */
	const createCategory = async (input: {
		name: string;
		color?: DecisionCategory["color"];
		icon?: DecisionCategory["icon"];
	}): Promise<DecisionCategory | null> => {
		try {
			return await categoryMutations.create.mutateAsync(input);
		} catch {
			// The mutation already raised a toast; returning null leaves the picker
			// open with what was typed still in it.
			return null;
		}
	};

	const actionsFor = (decision: Decision) => ({
		canEdit,
		busy,
		onFinalize: () => mutations.finalize.mutate(decision.id),
		onSupersede: () => openForm(decision.id),
	});

	return (
		<DeliveryPageShell
			icon={Gavel}
			title="Decisions"
			subtitle="What was decided, why, and what it replaced."
			action={
				canEdit ? (
					<PrimaryButton onClick={() => openForm()}>
						<Plus className="h-4 w-4" />
						Record a decision
					</PrimaryButton>
				) : undefined
			}
		>
			{canEdit && (
				<CreateDecisionModal
					isOpen={isCreating}
					pending={mutations.create.isPending}
					categories={categories}
					creatingCategory={categoryMutations.create.isPending}
					supersedesTitle={
						decisions.find((entry) => entry.id === supersedes)?.title ?? null
					}
					onCreateCategory={createCategory}
					onClose={() => {
						setIsCreating(false);
						setSupersedes(null);
					}}
					// Closes immediately: the optimistic card is already in the list, so
					// holding the dialog open would hide the thing it created.
					onSubmit={(body) => {
						mutations.create.mutate({
							...body,
							supersedes_decision_id: supersedes ?? undefined,
						});
						setIsCreating(false);
						setSupersedes(null);
					}}
				/>
			)}

			{canEdit && (
				<ManageCategoriesModal
					isOpen={managingCategories}
					categories={categories}
					decisionCounts={decisionCounts}
					busy={
						categoryMutations.create.isPending ||
						categoryMutations.update.isPending ||
						categoryMutations.remove.isPending
					}
					onClose={() => setManagingCategories(false)}
					onCreate={(input) => categoryMutations.create.mutate(input)}
					onUpdate={(id, body) => categoryMutations.update.mutate({ id, body })}
					onDelete={(id) => {
						categoryMutations.remove.mutate(id);
						// The filter would otherwise point at a category that no longer
						// exists, showing an empty list with no way back.
						if (categoryFilter === id) setCategoryFilter(null);
					}}
				/>
			)}

			{decisions.length === 0 ? (
				<DeliveryEmpty
					icon={Gavel}
					title="No decisions recorded"
					description="Decisions get made in chat and then forgotten, and the reasoning goes with them."
					hints={[
						"What was chosen, and why",
						"What else was on the table",
						"The work it affects",
					]}
					action={
						canEdit ? (
							<PrimaryButton onClick={() => openForm()}>
								<Plus className="h-4 w-4" />
								Record the first one
							</PrimaryButton>
						) : undefined
					}
				/>
			) : (
				<>
					<DecisionHealth
						stats={stats}
						decisions={decisions}
						projectId={projectId}
					/>

					<CategoryFilterRow
						decisions={decisions}
						categories={categories}
						value={categoryFilter}
						onChange={setCategoryFilter}
						onManage={() => setManagingCategories(true)}
						canEdit={canEdit}
					/>

					{visible.length === 0 ? (
						<p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
							Nothing filed under this category yet.
						</p>
					) : (
						// One card per row — the card lays its own body out in columns, so
						// the width is used rather than stretched.
						<div className="flex flex-col gap-3">
							{visible.map((decision) => (
								<DecisionCard
									key={decision.id}
									decision={decision}
									projectId={projectId}
									actions={actionsFor(decision)}
								/>
							))}
						</div>
					)}
				</>
			)}
		</DeliveryPageShell>
	);
}
