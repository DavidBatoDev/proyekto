import { Check } from "lucide-react";
import type { TimeLogStatus } from "@/services/team-time.service";

const STATUS_OPTIONS: { value: TimeLogStatus; label: string }[] = [
	{ value: "pending", label: "Pending" },
	{ value: "approved", label: "Approved" },
	{ value: "paid", label: "Paid" },
	{ value: "rejected", label: "Rejected" },
];

/**
 * Multi-select status filter. An empty set means "All". Selecting one or more
 * statuses narrows to that combination (e.g. Pending + Approved). Filtering is
 * applied client-side by the caller, so any combination is supported.
 */
export function LogStatusFilter({
	value,
	onChange,
}: {
	value: Set<TimeLogStatus>;
	onChange: (next: Set<TimeLogStatus>) => void;
}) {
	const allActive = value.size === 0;

	const toggle = (status: TimeLogStatus) => {
		const next = new Set(value);
		if (next.has(status)) next.delete(status);
		else next.add(status);
		onChange(next);
	};

	return (
		<div className="inline-flex flex-wrap items-center gap-1">
			<button
				type="button"
				aria-pressed={allActive}
				onClick={() => onChange(new Set())}
				className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
					allActive
						? "border-sky-300 bg-sky-50 text-sky-700"
						: "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
				}`}
			>
				All
			</button>
			{STATUS_OPTIONS.map((opt) => {
				const on = value.has(opt.value);
				return (
					<button
						key={opt.value}
						type="button"
						aria-pressed={on}
						onClick={() => toggle(opt.value)}
						className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
							on
								? "border-sky-300 bg-sky-50 text-sky-700"
								: "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
						}`}
					>
						<span
							className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded border ${
								on
									? "border-sky-500 bg-sky-500 text-white"
									: "border-slate-300 bg-white text-transparent"
							}`}
						>
							<Check className="h-2.5 w-2.5" strokeWidth={3} />
						</span>
						{opt.label}
					</button>
				);
			})}
		</div>
	);
}
