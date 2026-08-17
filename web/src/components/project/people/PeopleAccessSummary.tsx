import type { PeopleSummary } from "@/lib/projectPeople";

/**
 * "5 people · 2 can edit · 2 view-only · 1 not on a team", as filter pills.
 *
 * The point is the question a non-technical consultant actually asks — *who
 * can change things, and who here isn't ours?* — answered before they read a
 * single row. Clicking a count filters the roster to it.
 *
 * Not `AppStatCard`: that renders a 3xl number per metric, which would give
 * this more visual weight than the roster it describes.
 */

export type PeopleFilter = "all" | "can-edit" | "view-only" | "external";

export function PeopleAccessSummary({
	summary,
	active,
	onChange,
}: {
	summary: PeopleSummary;
	active: PeopleFilter;
	onChange: (next: PeopleFilter) => void;
}) {
	const pills: Array<{ key: PeopleFilter; label: string; count: number }> = [
		{
			key: "all",
			label: summary.total === 1 ? "person" : "people",
			count: summary.total,
		},
		{ key: "can-edit", label: "can edit", count: summary.canEdit },
		{ key: "view-only", label: "view-only", count: summary.viewOnly },
		{ key: "external", label: "not on a team", count: summary.external },
	];

	return (
		<div className="flex flex-wrap items-center gap-1.5">
			{pills.map((pill) => {
				// Don't offer a filter that would empty the list.
				const selectable = pill.key === "all" || pill.count > 0;
				const isActive = active === pill.key;
				return (
					<button
						key={pill.key}
						type="button"
						disabled={!selectable}
						onClick={() =>
							onChange(isActive && pill.key !== "all" ? "all" : pill.key)
						}
						className={`rounded-full border px-2.5 py-1 text-xs transition ${
							isActive
								? "border-primary bg-primary/10 font-semibold text-primary"
								: "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
						} ${selectable ? "" : "cursor-default opacity-50 hover:bg-transparent"}`}
					>
						<span className="font-semibold tabular-nums">{pill.count}</span>{" "}
						{pill.label}
					</button>
				);
			})}
		</div>
	);
}
