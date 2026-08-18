import { CircleDollarSign, Loader2 } from "lucide-react";
import { AppEmptyState } from "@/components/common/AppPrimitives";

/**
 * The small shared pieces every finance section draws.
 *
 * They lived as private helpers inside the one finance route; splitting the
 * sections into their own routes would otherwise have meant four copies of the
 * same status badge drifting apart.
 */
export function FinanceSectionHeading({
	eyebrow,
	title,
	description,
	count,
}: {
	eyebrow: string;
	title: string;
	description: string;
	count: string;
}) {
	return (
		<div className="flex flex-col justify-between gap-3 pt-1 sm:flex-row sm:items-end">
			<div>
				<p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
					{eyebrow}
				</p>
				<h2 className="mt-1 text-xl font-bold tracking-tight text-foreground">
					{title}
				</h2>
				<p className="mt-1 text-sm text-muted-foreground">{description}</p>
			</div>
			<span className="w-fit rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm">
				{count}
			</span>
		</div>
	);
}

export function FinanceStatusBadge({ status }: { status: string }) {
	const normalized = status.toLowerCase();
	const tone = ["active", "paid", "signed"].includes(normalized)
		? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300"
		: ["issued", "sent"].includes(normalized)
			? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300"
			: "border-border bg-muted/60 text-muted-foreground";

	return (
		<span
			className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${tone}`}
		>
			{status}
		</span>
	);
}

export function FinanceLoading() {
	return (
		<div className="flex justify-center py-16">
			<Loader2 className="h-6 w-6 animate-spin text-primary" />
		</div>
	);
}

export function NoFinanceData() {
	return (
		<AppEmptyState
			icon={CircleDollarSign}
			title="No finance records match"
			description="Adjust the filters or choose another project."
		/>
	);
}
