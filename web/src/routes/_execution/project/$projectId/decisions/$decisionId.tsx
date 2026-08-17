import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowLeft,
	ArrowUpDown,
	CircleCheck,
	CircleDashed,
	Gavel,
	Link2,
	Lock,
	Plus,
	Trash2,
	X,
} from "lucide-react";
import { useState } from "react";
import { AppConfirmDialog } from "@/components/common/AppConfirmDialog";
import { AppTabs } from "@/components/common/AppTabs";
import { RequireProjectAccess } from "@/components/common/RequireProjectAccess";
import { CategoryChip } from "@/components/project/delivery/CategoryChip";
import { CategoryCombobox } from "@/components/project/delivery/CategoryCombobox";
import { CreateDecisionModal } from "@/components/project/delivery/CreateDecisionModal";
import {
	DeliverySkeleton,
	FieldError,
	inputClassFor,
	ListBox,
	ListEmpty,
	ListRow,
	PrimaryButton,
	RoadmapNodeGlyph,
	SecondaryButton,
	StatusPill,
} from "@/components/project/delivery/DeliveryPrimitives";
import {
	OPTION_TITLE_MAX,
	validateOptionTitle,
} from "@/components/project/delivery/decisionForm";
import {
	DECISION_STATUS_LABEL,
	DECISION_STATUS_TONE,
	decisionLinkSegments,
	decisionReference,
} from "@/components/project/delivery/decisionModel";
import { LinkRoadmapWorkModal } from "@/components/project/delivery/LinkRoadmapWorkModal";
import { ActivityFeed } from "@/components/project/logs/ActivityFeed";
import { useProjectActivityQuery } from "@/hooks/useActivityQueries";
import {
	useDecisionCategoriesQuery,
	useDecisionCategoryMutations,
	useDecisionMutations,
	useDecisionQuery,
	useDecisionsQuery,
} from "@/hooks/useDeliveryQueries";
import { useProjectMyPermissionsQuery } from "@/hooks/useProjectQueries";
import type { Decision, DecisionCategory } from "@/services/delivery.service";

const TABS = ["overview", "options", "impact", "activity"] as const;
type Tab = (typeof TABS)[number];

interface DecisionSearch {
	/**
	 * Optional so the default tab leaves the URL clean — and so every `<Link>` to
	 * this route isn't forced to pass a `search` prop.
	 */
	tab?: Tab;
}

export const Route = createFileRoute(
	"/_execution/project/$projectId/decisions/$decisionId",
)({
	validateSearch: (search: Record<string, unknown>): DecisionSearch => ({
		tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : undefined,
	}),
	component: DecisionDetailPage,
});

function DecisionDetailPage() {
	const { projectId } = Route.useParams();
	return (
		<RequireProjectAccess
			projectId={projectId}
			access="delivery"
			loadingFallback={<DeliverySkeleton rows={1} />}
		>
			<DecisionDetailBody />
		</RequireProjectAccess>
	);
}

function DecisionDetailBody() {
	const { projectId, decisionId } = Route.useParams();
	const { tab = "overview" } = Route.useSearch();
	const navigate = useNavigate();

	const query = useDecisionQuery(projectId, decisionId);
	const listQuery = useDecisionsQuery(projectId);
	const categoriesQuery = useDecisionCategoriesQuery(projectId);
	const permissions = useProjectMyPermissionsQuery(projectId);
	const mutations = useDecisionMutations(projectId);
	const categoryMutations = useDecisionCategoryMutations(projectId);

	const [isDeleting, setIsDeleting] = useState(false);
	const [isLinking, setIsLinking] = useState(false);
	const [isSuperseding, setIsSuperseding] = useState(false);

	const canEdit = permissions.data?.decisions?.edit === true;
	const decision = query.data;

	if (query.isPending) return <DeliverySkeleton rows={1} />;
	if (!decision) {
		return (
			<div className="app-shell-bg flex h-full w-full items-center justify-center">
				<p className="text-sm text-muted-foreground">
					This decision no longer exists.
				</p>
			</div>
		);
	}

	const categories = categoriesQuery.data ?? [];
	const superseded = decision.status === "superseded";
	const proposed = decision.status === "proposed";
	const busy =
		mutations.finalize.isPending ||
		mutations.addOption.isPending ||
		mutations.updateOption.isPending ||
		mutations.removeOption.isPending ||
		mutations.addLink.isPending ||
		mutations.removeLink.isPending;

	// The row this one replaced, and the row that replaced it — both read from the
	// list already in cache rather than fetched again.
	const all = listQuery.data ?? [];
	const replaced =
		all.find((d) => d.id === decision.supersedes_decision_id) ?? null;
	const replacedBy =
		all.find((d) => d.supersedes_decision_id === decision.id) ?? null;

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

	return (
		<div className="app-shell-bg h-full w-full overflow-y-auto">
			{/* Same top bar as the list page: page chrome running edge to edge,
			    holding its ground while the tabs scroll under it. */}
			<header className="sticky top-0 z-10 border-b border-border bg-card/90 px-6 py-3.5 backdrop-blur md:px-10">
				<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
					<div className="min-w-0">
						<Link
							to="/project/$projectId/decisions"
							params={{ projectId }}
							className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
						>
							<ArrowLeft className="h-3 w-3" />
							Decisions
						</Link>
						<div className="flex flex-wrap items-center gap-2">
							<span className="font-mono text-xs font-semibold text-muted-foreground">
								{decisionReference(decision)}
							</span>
							<h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
								{decision.title}
							</h1>
							<StatusPill
								label={DECISION_STATUS_LABEL[decision.status]}
								tone={DECISION_STATUS_TONE[decision.status]}
							/>
							<CategoryChip category={decision.category} size="sm" />
							{decision.visibility === "internal" && (
								<span
									className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground"
									title="Internal — not shared with everyone on the project"
								>
									<Lock className="h-3 w-3" />
									Internal
								</span>
							)}
						</div>
					</div>

					<div className="flex shrink-0 items-center gap-2">
						{canEdit && proposed && (
							<PrimaryButton
								onClick={() => mutations.finalize.mutate(decision.id)}
								disabled={busy}
							>
								<Gavel className="h-4 w-4" />
								Mark final
							</PrimaryButton>
						)}
						{canEdit && !superseded && !proposed && (
							<SecondaryButton
								onClick={() => setIsSuperseding(true)}
								disabled={busy}
							>
								<ArrowUpDown className="h-3.5 w-3.5" />
								Supersede
							</SecondaryButton>
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

			{/* Deleting takes the options and links with it, so it asks first. */}
			<AppConfirmDialog
				open={isDeleting}
				tone="danger"
				title="Delete this decision?"
				message={`"${decision.title}" and everything recorded against it — the options weighed and the work it was linked to — will be removed. Superseding it instead keeps the history. This can't be undone.`}
				confirmLabel="Delete decision"
				busy={mutations.remove.isPending}
				onClose={() => setIsDeleting(false)}
				onConfirm={() =>
					mutations.remove.mutate(decision.id, {
						onSuccess: () => {
							setIsDeleting(false);
							navigate({
								to: "/project/$projectId/decisions",
								params: { projectId },
							});
						},
					})
				}
			/>

			{canEdit && (
				<CreateDecisionModal
					isOpen={isSuperseding}
					pending={mutations.create.isPending}
					categories={categories}
					creatingCategory={categoryMutations.create.isPending}
					supersedesTitle={decision.title}
					onCreateCategory={createCategory}
					onClose={() => setIsSuperseding(false)}
					onSubmit={(body) => {
						mutations.create.mutate(
							{ ...body, supersedes_decision_id: decision.id },
							{
								// The replacement is a different row, so the page has to move
								// to it rather than sit on the one that just became history.
								onSuccess: (created) =>
									navigate({
										to: "/project/$projectId/decisions/$decisionId",
										params: { projectId, decisionId: created.id },
									}),
							},
						);
						setIsSuperseding(false);
					}}
				/>
			)}

			{canEdit && (
				<LinkRoadmapWorkModal
					projectId={projectId}
					links={decision.links ?? []}
					// The decision junction takes every target the roadmap and delivery
					// tree can offer, unlike its two siblings.
					allowed={["epic", "feature", "task", "milestone"]}
					isOpen={isLinking}
					title="Link the work this affects"
					description="What changes, or has to be built differently, because of this decision."
					busy={busy}
					onClose={() => setIsLinking(false)}
					onLink={(target) =>
						mutations.addLink.mutate({ id: decision.id, target })
					}
					onUnlink={(linkId) =>
						mutations.removeLink.mutate({ id: decision.id, linkId })
					}
				/>
			)}

			<div className="w-full px-6 py-7 md:px-10 md:py-9">
				{/* The decision itself, unboxed under the bar — the same rhythm as the
				    health strip on the list page. It is the one thing on this page
				    that should never need a click to read. */}
				<div className="mb-6 border-b border-border pb-5">
					<p className="max-w-3xl text-base text-foreground">
						{decision.decision}
					</p>
					{superseded && replacedBy && (
						<p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
							<ArrowUpDown className="h-3.5 w-3.5" />
							Replaced by{" "}
							<Link
								to="/project/$projectId/decisions/$decisionId"
								params={{ projectId, decisionId: replacedBy.id }}
								className="font-semibold text-primary hover:underline"
							>
								{decisionReference(replacedBy)} {replacedBy.title}
							</Link>
						</p>
					)}
				</div>

				<AppTabs
					items={[
						{ key: "overview", label: "Overview" },
						{
							key: "options",
							label: "Options",
							count: decision.options?.length,
						},
						{ key: "impact", label: "Impact", count: decision.links?.length },
						{ key: "activity", label: "Activity" },
					]}
					active={tab}
					// Router mode: each tab is a real link, so it can be shared,
					// bookmarked and reached with the back button.
					linkFor={(key) => ({
						to: "/project/$projectId/decisions/$decisionId",
						params: { projectId, decisionId },
						// Overview is the default, so it clears the param instead of
						// stamping ?tab=overview onto every share of the page.
						search: { tab: key === "overview" ? undefined : key },
					})}
					variant="underline"
					className="mb-5"
				/>

				{tab === "overview" && (
					<OverviewTab
						decision={decision}
						replaced={replaced}
						projectId={projectId}
						categories={categories}
						canEdit={canEdit && !superseded}
						creatingCategory={categoryMutations.create.isPending}
						onCreateCategory={createCategory}
						onChangeCategory={(category) =>
							mutations.update.mutate({
								id: decision.id,
								body: { category_id: category?.id ?? null },
								// Passed so the header chip repaints before the response
								// lands, rather than a beat later.
								category,
							})
						}
					/>
				)}
				{tab === "options" && (
					<OptionsTab
						decision={decision}
						canEdit={canEdit && !superseded}
						busy={busy}
						onAdd={(title) =>
							mutations.addOption.mutate({ id: decision.id, body: { title } })
						}
						onSelect={(optionId) =>
							mutations.updateOption.mutate({
								id: decision.id,
								optionId,
								body: { is_selected: true },
							})
						}
						onRemove={(optionId) =>
							mutations.removeOption.mutate({ id: decision.id, optionId })
						}
					/>
				)}
				{tab === "impact" && (
					<ImpactTab
						decision={decision}
						canEdit={canEdit && !superseded}
						onOpenLinkPicker={() => setIsLinking(true)}
						onUnlink={(linkId) =>
							mutations.removeLink.mutate({ id: decision.id, linkId })
						}
					/>
				)}
				{tab === "activity" && (
					<ActivityTab projectId={projectId} decisionId={decisionId} />
				)}
			</div>
		</div>
	);
}

function OverviewTab({
	decision,
	replaced,
	projectId,
	categories,
	canEdit,
	creatingCategory,
	onCreateCategory,
	onChangeCategory,
}: {
	decision: Decision;
	replaced: Decision | null;
	projectId: string;
	categories: DecisionCategory[];
	canEdit: boolean;
	creatingCategory: boolean;
	onCreateCategory: (input: {
		name: string;
		color?: DecisionCategory["color"];
		icon?: DecisionCategory["icon"];
	}) => Promise<DecisionCategory | null>;
	onChangeCategory: (category: DecisionCategory | null) => void;
}) {
	return (
		<div className="grid gap-4 lg:grid-cols-2">
			<ListBox title="Context and reasoning" bodyClassName="min-h-[13rem]">
				{canEdit && (
					// The one field editable in place. Everything else about a decision
					// changes by superseding it, because the wording IS the record — but
					// filing it under the wrong category is a clerical slip, not a change
					// of mind, and forcing a new version for that would be absurd.
					<div className="border-b border-border/60 px-4 py-3">
						<p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
							Category
						</p>
						<div className="max-w-xs">
							<CategoryCombobox
								categories={categories}
								value={decision.category_id ?? ""}
								onChange={(categoryId) =>
									onChangeCategory(
										categories.find((c) => c.id === categoryId) ?? null,
									)
								}
								onCreate={onCreateCategory}
								creating={creatingCategory}
							/>
						</div>
					</div>
				)}
				<div className="px-4 py-3">
					<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
						What prompted it
					</p>
					<p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
						{decision.context || (
							<span className="text-muted-foreground">
								No context recorded.
							</span>
						)}
					</p>
				</div>
				<div className="border-t border-border/60 px-4 py-3">
					<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
						Why this was chosen
					</p>
					<p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
						{decision.rationale || (
							<span className="text-muted-foreground">
								No reasoning recorded — the thing most likely to be missed
								later.
							</span>
						)}
					</p>
				</div>
			</ListBox>

			<ListBox
				title="History"
				meta={decision.version > 1 ? `Version ${decision.version}` : undefined}
				bodyClassName="min-h-[13rem]"
			>
				<ListRow>
					<CircleCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
					<span className="flex-1">
						{decision.status === "proposed"
							? "Proposed, not yet settled"
							: `Decided ${decision.decided_on}`}
					</span>
				</ListRow>
				{replaced ? (
					<ListRow>
						<ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
						<span className="flex-1 min-w-0">
							Replaced{" "}
							<Link
								to="/project/$projectId/decisions/$decisionId"
								params={{ projectId, decisionId: replaced.id }}
								className="font-semibold text-primary hover:underline"
							>
								{decisionReference(replaced)} {replaced.title}
							</Link>
						</span>
					</ListRow>
				) : (
					<ListRow>
						<ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
						<span className="flex-1 text-muted-foreground">
							This is the first decision on the question.
						</span>
					</ListRow>
				)}
				{decision.alternatives_considered && (
					// Prose from before options were structured. Read-only: it is
					// history, and re-editing it here would create two places to say the
					// same thing.
					<div className="border-t border-border/60 bg-muted/20 px-4 py-3">
						<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
							Alternatives, recorded as free text
						</p>
						<p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
							{decision.alternatives_considered}
						</p>
					</div>
				)}
			</ListBox>
		</div>
	);
}

function OptionsTab({
	decision,
	canEdit,
	busy,
	onAdd,
	onSelect,
	onRemove,
}: {
	decision: Decision;
	canEdit: boolean;
	busy: boolean;
	onAdd: (title: string) => void;
	onSelect: (optionId: string) => void;
	onRemove: (optionId: string) => void;
}) {
	const [draft, setDraft] = useState("");
	const [error, setError] = useState<string | null>(null);
	const options = decision.options ?? [];

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		const found = validateOptionTitle(draft, options);
		setError(found);
		if (found) return;
		onAdd(draft.trim());
		setDraft("");
	};

	return (
		<ListBox
			title="Options considered"
			meta={options.length > 0 ? `${options.length} weighed` : undefined}
			bodyClassName="min-h-[16rem]"
		>
			{options.length === 0 && (
				<ListEmpty>
					Nothing recorded. Months from now, "why didn't we use the other one?"
					is the question this answers.
				</ListEmpty>
			)}

			{options.map((option) => (
				<ListRow key={option.id} className="items-start py-2.5">
					{canEdit ? (
						<button
							type="button"
							onClick={() => !option.is_selected && onSelect(option.id)}
							disabled={busy || option.is_selected}
							aria-label={
								option.is_selected
									? "This was the chosen option"
									: "Make this the chosen option"
							}
							className="mt-0.5 shrink-0 rounded-full transition-colors disabled:cursor-default"
						>
							{option.is_selected ? (
								<CircleCheck className="h-4 w-4 text-success" />
							) : (
								<CircleDashed className="h-4 w-4 text-muted-foreground hover:text-foreground" />
							)}
						</button>
					) : (
						<span className="mt-0.5 shrink-0">
							{option.is_selected ? (
								<CircleCheck className="h-4 w-4 text-success" />
							) : (
								<CircleDashed className="h-4 w-4 text-muted-foreground" />
							)}
						</span>
					)}

					<span className="min-w-0 flex-1">
						<span className="flex flex-wrap items-center gap-2">
							<span
								className={
									option.is_selected
										? "font-semibold text-foreground"
										: "text-foreground"
								}
							>
								{option.title}
							</span>
							{option.is_selected && (
								<span className="rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
									Chosen
								</span>
							)}
						</span>
						{option.detail && (
							<span className="mt-0.5 block whitespace-pre-wrap text-xs text-muted-foreground">
								{option.detail}
							</span>
						)}
					</span>

					{canEdit && (
						<button
							type="button"
							onClick={() => onRemove(option.id)}
							disabled={busy}
							aria-label={`Remove ${option.title}`}
							className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					)}
				</ListRow>
			))}

			{canEdit && (
				<form
					onSubmit={submit}
					className="border-t border-border bg-muted/20 px-4 py-2.5"
				>
					<div className="flex items-center gap-2">
						<input
							value={draft}
							onChange={(event) => {
								setDraft(event.target.value);
								if (error) setError(null);
							}}
							maxLength={OPTION_TITLE_MAX + 1}
							className={`${inputClassFor(error)} py-1.5`}
							aria-invalid={Boolean(error)}
							placeholder="Another option that was on the table"
						/>
						<PrimaryButton type="submit" disabled={busy}>
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

function ImpactTab({
	decision,
	canEdit,
	onOpenLinkPicker,
	onUnlink,
}: {
	decision: Decision;
	canEdit: boolean;
	onOpenLinkPicker: () => void;
	onUnlink: (linkId: string) => void;
}) {
	const links = decision.links ?? [];

	return (
		<ListBox
			title="Work this affects"
			meta={links.length > 0 ? `${links.length} linked` : undefined}
			bodyClassName="min-h-[13rem]"
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
					Nothing linked yet, so this decision won't surface when someone opens
					the work it governs.
				</ListEmpty>
			) : (
				links.map((link) => {
					const segments = decisionLinkSegments(link);
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
											{/* Box-drawing connector, so the hierarchy is legible at
											    a glance rather than parsed out of separators. */}
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
							{canEdit && (
								<button
									type="button"
									onClick={() => onUnlink(link.id)}
									aria-label="Unlink"
									className="shrink-0 self-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
								>
									<X className="h-3.5 w-3.5" />
								</button>
							)}
						</ListRow>
					);
				})
			)}
		</ListBox>
	);
}

function ActivityTab({
	projectId,
	decisionId,
}: {
	projectId: string;
	decisionId: string;
}) {
	const query = useProjectActivityQuery(projectId, {
		entity_type: "decision",
		entity_id: decisionId,
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
