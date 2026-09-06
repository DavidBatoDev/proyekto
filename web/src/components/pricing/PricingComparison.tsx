import { Check, Minus } from "lucide-react";
import { type Cell, FEATURE_GROUPS, PLANS } from "@/lib/pricing";

function Value({ value, label }: { value: Cell; label: string }) {
	if (value === true) {
		return (
			<>
				<Check className="mx-auto h-4 w-4 text-primary" aria-hidden />
				<span className="sr-only">{`${label}: included`}</span>
			</>
		);
	}
	if (value === false) {
		return (
			<>
				<Minus
					className="mx-auto h-4 w-4 text-muted-foreground/40"
					aria-hidden
				/>
				<span className="sr-only">{`${label}: not included`}</span>
			</>
		);
	}
	return <span className="text-sm text-foreground">{value}</span>;
}

/**
 * The full plan-by-plan grid under the cards.
 *
 * A real `<table>` rather than a grid of divs: the row header/column header
 * relationship is what makes 40 rows of checkmarks navigable with a screen
 * reader, and it is exactly what a table encodes for free.
 *
 * The whole thing scrolls sideways on a narrow screen with the feature column
 * pinned — four plan columns cannot honestly fit on a phone, and stacking them
 * into four separate lists destroys the one thing this section is for.
 */
export function PricingComparison() {
	return (
		<div className="overflow-x-auto">
			<table className="w-full min-w-[46rem] border-collapse text-left">
				<caption className="sr-only">
					Feature comparison across all plans
				</caption>
				<thead>
					<tr>
						<th
							scope="col"
							className="sticky left-0 z-10 w-[34%] bg-background pb-5 text-base font-semibold text-foreground"
						>
							Features
						</th>
						{PLANS.map((plan) => (
							<th
								key={plan.id}
								scope="col"
								className="pb-5 text-center text-base font-semibold text-foreground"
							>
								{plan.name}
							</th>
						))}
					</tr>
				</thead>

				{FEATURE_GROUPS.map((group) => (
					<tbody key={group.title}>
						<tr>
							<th
								scope="colgroup"
								colSpan={PLANS.length + 1}
								className="sticky left-0 border-t border-border pb-3 pt-10 text-left text-sm font-semibold uppercase tracking-wide text-muted-foreground"
							>
								{group.title}
							</th>
						</tr>
						{group.rows.map((r) => (
							<tr key={r.label} className="border-t border-border/60">
								<th
									scope="row"
									className="sticky left-0 z-10 bg-background py-3.5 pr-6 text-sm font-normal text-foreground"
								>
									{r.label}
									{r.note && (
										<span className="mt-0.5 block text-xs text-muted-foreground">
											{r.note}
										</span>
									)}
								</th>
								{PLANS.map((plan) => (
									<td key={plan.id} className="px-3 py-3.5 text-center">
										<Value value={r.values[plan.id]} label={r.label} />
									</td>
								))}
							</tr>
						))}
					</tbody>
				))}
			</table>
		</div>
	);
}
