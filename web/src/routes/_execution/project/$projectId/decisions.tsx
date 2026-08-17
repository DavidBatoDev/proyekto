import {
	createFileRoute,
	Outlet,
	useChildMatches,
} from "@tanstack/react-router";
import { Gavel, Plus, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { RequireProjectAccess } from "@/components/common/RequireProjectAccess";
import { DecisionEntry } from "@/components/project/decisions/DecisionEntry";
import { DecisionFilterRail } from "@/components/project/decisions/DecisionFilterRail";
import {
	DecisionButton,
	DecisionEmpty,
	DecisionLedger,
	DecisionPageShell,
	DecisionSkeleton,
	MonthBand,
} from "@/components/project/decisions/DecisionPrimitives";
import {
	type DecisionFilters,
	filterDecisions,
	groupDecisionsByMonth,
	NO_DECISION_FILTERS,
	supersededWithin,
} from "@/components/project/decisions/decisionLog";
import { CreateDecisionModal } from "@/components/project/delivery/CreateDecisionModal";
import {
	needsOptionChoice,
	summarizeDecisions,
} from "@/components/project/delivery/decisionModel";
import { FinalizeDecisionModal } from "@/components/project/delivery/FinalizeDecisionModal";
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
 * Layout route: the detail page renders through the outlet, so the log's filter
 * state survives navigating into a decision and back.
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
			loadingFallback={<DecisionSkeleton />}
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
	const [finalizing, setFinalizing] = useState<string | null>(null);
	const [filters, setFilters] = useState<DecisionFilters>(NO_DECISION_FILTERS);
	const [filtersOpen, setFiltersOpen] = useState(false);

	const canEdit = permissions.data?.decisions?.edit === true;

	const decisions = useMemo(() => query.data ?? [], [query.data]);
	const categories = useMemo(
		() => categoriesQuery.data ?? [],
		[categoriesQuery.data],
	);
	const stats = useMemo(() => summarizeDecisions(decisions), [decisions]);

	// Filtering client-side: the whole log is already cached, and a round trip per
	// checkbox would make the rail's counts lag the selection.
	const visible = useMemo(
		() => filterDecisions(decisions, filters),
		[decisions, filters],
	);

	const months = useMemo(() => groupDecisionsByMonth(visible), [visible]);
	const replaced = useMemo(() => supersededWithin(visible), [visible]);
	/** Titles by id, so an entry can name what it replaces without a lookup. */
	const titles = useMemo(
		() => new Map(decisions.map((decision) => [decision.id, decision.title])),
		[decisions],
	);

	const decisionCounts = useMemo(() => {
		const counts: Record<string, number> = {};
		for (const decision of decisions) {
			if (decision.category_id) {
				counts[decision.category_id] = (counts[decision.category_id] ?? 0) + 1;
			}
		}
		return counts;
	}, [decisions]);

	if (query.isPending) return <DecisionSkeleton />;

	const openForm = (supersedeId?: string) => {
		setSupersedes(supersedeId ?? null);
		setIsCreating(true);
	};

	const busy = mutations.finalize.isPending || mutations.updateOption.isPending;

	const createCategory = async (input: {
		name: string;
		color?: DecisionCategory["color"];
		icon?: DecisionCategory["icon"];
	}): Promise<DecisionCategory | null> => {
		try {
			return await categoryMutations.create.mutateAsync(input);
		} catch {
			return null;
		}
	};

	/** Finalizing stops to ask which option won when the record doesn't say. */
	const startFinalize = (decision: Decision) => {
		if (needsOptionChoice(decision)) {
			setFinalizing(decision.id);
			return;
		}
		mutations.finalize.mutate(decision.id);
	};

	const finalizeDecision = async (id: string, optionId: string | null) => {
		if (optionId) {
			try {
				await mutations.updateOption.mutateAsync({
					id,
					optionId,
					body: { is_selected: true },
				});
			} catch {
				// The mutation toasted and rolled back; settling anyway would record a
				// final decision whose chosen option silently failed to save.
				return;
			}
		}
		mutations.finalize.mutate(id);
		setFinalizing(null);
	};

	const finalizingDecision =
		decisions.find((entry) => entry.id === finalizing) ?? null;

	const rail = (
		<DecisionFilterRail
			decisions={decisions}
			categories={categories}
			filters={filters}
			onChange={setFilters}
			onManage={() => setManagingCategories(true)}
			canEdit={canEdit}
		/>
	);

	return (
		<DecisionPageShell
			title="Decisions"
			subtitle="What was decided, why, and what it replaced."
			rail={rail}
			mobileRail={
				filtersOpen ? (
					<div className="fixed inset-0 z-50 md:hidden">
						<button
							type="button"
							aria-label="Close filters"
							className="absolute inset-0 bg-foreground/20"
							onClick={() => setFiltersOpen(false)}
						/>
						<div className="absolute inset-y-0 left-0 w-72 border-r border-border bg-card shadow-xl">
							<DecisionFilterRail
								decisions={decisions}
								categories={categories}
								filters={filters}
								onChange={setFilters}
								onManage={() => setManagingCategories(true)}
								canEdit={canEdit}
								onClose={() => setFiltersOpen(false)}
							/>
						</div>
					</div>
				) : undefined
			}
			ledger={
				decisions.length > 0 ? (
					<DecisionLedger>
						{stats.total} recorded · {stats.proposed} proposed ·{" "}
						{stats.superseded} superseded
						{stats.lastDecidedOn && ` · last ${stats.lastDecidedOn}`}
					</DecisionLedger>
				) : undefined
			}
			action={
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => setFiltersOpen(true)}
						className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground md:hidden"
					>
						<SlidersHorizontal className="h-3.5 w-3.5" />
						Filters
					</button>
					{canEdit && (
						<DecisionButton tone="solid" onClick={() => openForm()}>
							<Plus className="h-3.5 w-3.5" />
							Record a decision
						</DecisionButton>
					)}
				</div>
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
					// Closes immediately: the optimistic entry is already in the log, so
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
						// The filter would otherwise hold a category that no longer exists,
						// showing an empty log with no way back.
						setFilters((current) => ({
							...current,
							categoryIds: current.categoryIds.filter((value) => value !== id),
						}));
					}}
				/>
			)}

			{canEdit && finalizingDecision && (
				<FinalizeDecisionModal
					isOpen
					decision={finalizingDecision}
					pending={
						mutations.updateOption.isPending || mutations.finalize.isPending
					}
					onClose={() => setFinalizing(null)}
					onConfirm={(optionId) =>
						void finalizeDecision(finalizingDecision.id, optionId)
					}
				/>
			)}

			{decisions.length === 0 ? (
				<DecisionEmpty
					icon={Gavel}
					title="No decisions recorded"
					description="Decisions get made in chat and then forgotten, and the reasoning goes with them. Record what was chosen, what else was on the table, and the work it affects."
					action={
						canEdit ? (
							<DecisionButton tone="solid" onClick={() => openForm()}>
								<Plus className="h-3.5 w-3.5" />
								Record the first one
							</DecisionButton>
						) : undefined
					}
				/>
			) : visible.length === 0 ? (
				<DecisionEmpty
					icon={Gavel}
					title="Nothing matches these filters"
					description="No decisions are filed under this combination. Reset the filters to see the whole log."
				/>
			) : (
				<div className="pb-10">
					{months.map((month, monthIndex) => (
						<section key={`${month.key}-${monthIndex}`}>
							<MonthBand label={month.label} />
							{month.decisions.map((decision, index) => {
								const replacedId = decision.supersedes_decision_id;
								return (
									<DecisionEntry
										key={decision.id}
										decision={decision}
										projectId={projectId}
										replacedTitle={
											replacedId ? (titles.get(replacedId) ?? null) : null
										}
										isReplaced={replaced.has(decision.id)}
										canEdit={canEdit}
										busy={busy}
										onFinalize={() => startFinalize(decision)}
										last={
											monthIndex === months.length - 1 &&
											index === month.decisions.length - 1
										}
									/>
								);
							})}
						</section>
					))}
				</div>
			)}
		</DecisionPageShell>
	);
}
