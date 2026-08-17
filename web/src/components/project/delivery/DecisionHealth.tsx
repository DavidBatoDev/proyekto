import { Link } from "@tanstack/react-router";
import { CircleDashed, Layers, Link2Off, Settings2, Tag } from "lucide-react";
import type { Decision, DecisionCategory } from "@/services/delivery.service";
import { StatBlock } from "./DeliveryHealth";
import {
	CATEGORY_ACCENT,
	CATEGORY_ICON,
	categoryCounts,
	type DecisionStats,
	daysOpen,
	decisionReference,
	needsAttention,
	uncategorizedCount,
} from "./decisionModel";

/** `null` is "All"; `""` is the uncategorised bucket. */
export type CategoryFilter = string | null;

/**
 * Decision health.
 *
 * States what the number *means* — "84% of live decisions are settled" — rather
 * than a bare percentage, which invites the reader to assume it measures
 * progress. Superseded rows are excluded from that fraction: a long-running
 * project accumulates them, and counting them as unsettled would make the
 * headline fall as the log gets better.
 */
export function DecisionHealth({
	stats,
	decisions,
	projectId,
}: {
	stats: DecisionStats;
	decisions: Decision[];
	projectId: string;
}) {
	const attention = needsAttention(decisions, 4);

	return (
		// Unboxed on purpose: these are page furniture, not a separate object, and
		// a card around them would compete with the decision cards below.
		<div className="mb-7 border-b border-border px-1 pb-7">
			<div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-12">
				<div>
					<div className="flex items-baseline gap-3">
						<span className="text-5xl font-semibold tracking-tight text-foreground">
							{stats.finalPercent === null ? "—" : `${stats.finalPercent}%`}
						</span>
						<span className="text-sm text-muted-foreground">
							{stats.finalPercent === null
								? "Nothing recorded yet"
								: "of live decisions are settled"}
						</span>
					</div>

					<div className="mt-4 h-2 max-w-3xl overflow-hidden rounded-full bg-muted">
						<div
							className="h-full rounded-full bg-success transition-all duration-500"
							style={{ width: `${stats.finalPercent ?? 0}%` }}
						/>
					</div>

					<div className="mt-7 flex flex-wrap gap-x-12 gap-y-5">
						<StatBlock value={stats.final} label="Final" tone="good" />
						<StatBlock
							value={stats.proposed}
							label="Proposed"
							tone={stats.proposed > 0 ? "warn" : undefined}
						/>
						<StatBlock value={stats.superseded} label="Superseded" />
						<StatBlock
							value={stats.unlinked}
							label="Unlinked"
							tone={stats.unlinked > 0 ? "warn" : undefined}
						/>
					</div>

					{stats.lastDecidedOn && (
						<p className="mt-5 text-xs text-muted-foreground">
							Last decision {stats.lastDecidedOn}
						</p>
					)}
				</div>

				<div className="lg:border-l lg:border-border lg:pl-12">
					<p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
						Needs attention
					</p>
					{attention.length === 0 ? (
						<p className="mt-3 text-sm text-muted-foreground">
							{stats.total === 0
								? "Nothing recorded yet."
								: "Everything is settled and traced to work."}
						</p>
					) : (
						<ul className="mt-3 flex flex-col gap-2.5">
							{attention.map((decision) => {
								const isProposed = decision.status === "proposed";
								return (
									<li key={decision.id} className="flex items-start gap-2">
										{isProposed ? (
											<CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
										) : (
											<Link2Off className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
										)}
										<span className="min-w-0">
											<Link
												to="/project/$projectId/decisions/$decisionId"
												params={{ projectId, decisionId: decision.id }}
												className="block truncate text-sm text-foreground hover:text-primary"
											>
												{decision.title}
											</Link>
											<span className="text-[11px] text-muted-foreground">
												{decisionReference(decision)} ·{" "}
												{isProposed
													? `open ${daysOpen(decision)} day${daysOpen(decision) === 1 ? "" : "s"}`
													: "not linked to any work"}
											</span>
										</span>
									</li>
								);
							})}
						</ul>
					)}
				</div>
			</div>
		</div>
	);
}

/**
 * The category filter.
 *
 * Chips rather than a select: the counts are the point — they say at a glance
 * where this project's decisions cluster, which a collapsed dropdown hides.
 * Categories with no decisions are still shown, so a newly created one does not
 * look like it failed to save.
 */
export function CategoryFilterRow({
	decisions,
	categories,
	value,
	onChange,
	onManage,
	canEdit,
}: {
	decisions: Decision[];
	categories: DecisionCategory[];
	value: CategoryFilter;
	onChange: (next: CategoryFilter) => void;
	onManage: () => void;
	canEdit: boolean;
}) {
	const counts = categoryCounts(decisions, categories);
	const uncategorized = uncategorizedCount(decisions);

	return (
		<div className="mb-5 flex flex-wrap items-center gap-1.5">
			<FilterChip
				active={value === null}
				onClick={() => onChange(null)}
				icon={Layers}
				label="All"
				count={decisions.length}
			/>

			{counts.map(({ category, count }) => {
				const Icon = CATEGORY_ICON[category.icon] ?? Tag;
				return (
					<FilterChip
						key={category.id}
						active={value === category.id}
						onClick={() => onChange(category.id)}
						icon={Icon}
						label={category.name}
						count={count}
						accent={CATEGORY_ACCENT[category.color]}
					/>
				);
			})}

			{uncategorized > 0 && (
				<FilterChip
					active={value === ""}
					onClick={() => onChange("")}
					icon={Tag}
					label="Uncategorised"
					count={uncategorized}
				/>
			)}

			{canEdit && (
				<button
					type="button"
					onClick={onManage}
					className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<Settings2 className="h-3.5 w-3.5" />
					{categories.length === 0 ? "Add categories" : "Manage categories"}
				</button>
			)}
		</div>
	);
}

function FilterChip({
	active,
	onClick,
	icon: Icon,
	label,
	count,
	accent,
}: {
	active: boolean;
	onClick: () => void;
	icon: typeof Tag;
	label: string;
	count: number;
	/** The category's own colour, shown while it is not the active filter. */
	accent?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
				active
					? "border-primary bg-primary text-primary-foreground"
					: `border-border hover:bg-muted ${accent ?? "text-muted-foreground"}`
			}`}
		>
			<Icon className="h-3 w-3" />
			{label}
			<span
				className={`rounded-full px-1.5 py-px text-[10px] ${
					active ? "bg-primary-foreground/20" : "bg-muted-foreground/10"
				}`}
			>
				{count}
			</span>
		</button>
	);
}
