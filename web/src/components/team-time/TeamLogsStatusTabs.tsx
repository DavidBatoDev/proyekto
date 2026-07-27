import type { LogStatusCounts, TimeLogStatus } from "@/services/team-time.service";

export type StatusTab = TimeLogStatus | "all";

const TABS: { key: StatusTab; label: string }[] = [
	{ key: "all", label: "All" },
	{ key: "pending", label: "Pending" },
	{ key: "approved", label: "Approved" },
	{ key: "paid", label: "Paid" },
	{ key: "rejected", label: "Rejected" },
];

/**
 * Status tabs for Team Logs. Replaces the old multi-select status chips: one
 * active status at a time, filtered server-side, with exact counts from the
 * summary (not capped by the 200-row list). "All" clears the status filter.
 */
export function TeamLogsStatusTabs({
	value,
	onChange,
	counts,
}: {
	value: StatusTab;
	onChange: (next: StatusTab) => void;
	counts?: LogStatusCounts;
}) {
	const countFor = (key: StatusTab): number | null => {
		if (!counts) return null;
		if (key === "all")
			return (
				counts.pending + counts.approved + counts.paid + counts.rejected
			);
		return counts[key];
	};

	return (
		<div
			role="tablist"
			aria-label="Filter logs by status"
			className="flex flex-wrap items-center gap-1 border-b border-slate-200"
		>
			{TABS.map((tab) => {
				const active = value === tab.key;
				const count = countFor(tab.key);
				return (
					<button
						key={tab.key}
						type="button"
						role="tab"
						aria-selected={active}
						onClick={() => onChange(tab.key)}
						className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
							active
								? "border-sky-600 text-sky-700"
								: "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
						}`}
					>
						{tab.label}
						{count !== null && (
							<span
								className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
									active
										? "bg-sky-100 text-sky-700"
										: "bg-slate-100 text-slate-500"
								}`}
							>
								{count}
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}
