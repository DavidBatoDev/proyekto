/**
 * Custom recurrence builder — "Repeat every N day/week/month/year", weekday
 * selection for weekly rules, and an end condition (never / on date / after N).
 * Emits an RFC-5545 rule body via lib/recurrence, with a live human summary.
 */
import { format } from "date-fns";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { ModalPortal } from "@/components/common/ModalPortal";
import {
	buildRRule,
	parseRRule,
	type RecurrenceRule,
	type RepeatFreq,
	rruleWeekdayOf,
	summarizeRRule,
} from "@/lib/recurrence";

interface RecurrenceBuilderDialogProps {
	open: boolean;
	startDate: Date;
	initialRrule?: string | null;
	onClose: () => void;
	onSave: (rrule: string) => void;
}

const FREQS: { value: RepeatFreq; label: string }[] = [
	{ value: "daily", label: "day" },
	{ value: "weekly", label: "week" },
	{ value: "monthly", label: "month" },
	{ value: "yearly", label: "year" },
];

// rrule weekday ints (Mon=0 … Sun=6) with single-letter labels.
const WEEKDAYS = [
	{ int: 6, label: "S" }, // Sun
	{ int: 0, label: "M" },
	{ int: 1, label: "T" },
	{ int: 2, label: "W" },
	{ int: 3, label: "T" },
	{ int: 4, label: "F" },
	{ int: 5, label: "S" }, // Sat
];

function seed(startDate: Date, rrule?: string | null): RecurrenceRule {
	if (rrule) return parseRRule(rrule);
	return {
		freq: "weekly",
		interval: 1,
		byweekday: [rruleWeekdayOf(startDate)],
		ends: { type: "never" },
	};
}

export function RecurrenceBuilderDialog({
	open,
	startDate,
	initialRrule,
	onClose,
	onSave,
}: RecurrenceBuilderDialogProps) {
	const [rule, setRule] = useState<RecurrenceRule>(() =>
		seed(startDate, initialRrule),
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-seed on open only.
	useEffect(() => {
		if (open) setRule(seed(startDate, initialRrule));
	}, [open]);

	if (!open) return null;

	const patch = (p: Partial<RecurrenceRule>) =>
		setRule((r) => ({ ...r, ...p }));

	const toggleWeekday = (int: number) => {
		const cur = rule.byweekday ?? [];
		const next = cur.includes(int)
			? cur.filter((d) => d !== int)
			: [...cur, int];
		patch({ byweekday: next.length ? next : [rruleWeekdayOf(startDate)] });
	};

	const built = buildRRule(rule);
	const summary = summarizeRRule(built, startDate);

	return (
		<ModalPortal>
			<div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50 p-4">
				<div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white shadow-xl">
					<div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
						<h3 className="text-base font-semibold text-gray-900">
							Custom recurrence
						</h3>
						<button
							type="button"
							onClick={onClose}
							aria-label="Close"
							className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
						>
							<X className="h-4 w-4" />
						</button>
					</div>

					<div className="space-y-4 px-5 py-4">
						{/* Interval + frequency */}
						<div className="flex items-center gap-2 text-sm text-gray-700">
							<span>Repeat every</span>
							<input
								type="number"
								min={1}
								max={99}
								value={rule.interval}
								onChange={(e) =>
									patch({ interval: Math.max(1, Number(e.target.value) || 1) })
								}
								className="w-16 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
							/>
							<select
								value={rule.freq}
								onChange={(e) => patch({ freq: e.target.value as RepeatFreq })}
								className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
							>
								{FREQS.map((f) => (
									<option key={f.value} value={f.value}>
										{f.label}
										{rule.interval > 1 ? "s" : ""}
									</option>
								))}
							</select>
						</div>

						{/* Weekday picker for weekly rules */}
						{rule.freq === "weekly" && (
							<div>
								<p className="mb-1.5 text-xs font-medium text-gray-500">
									Repeat on
								</p>
								<div className="flex gap-1">
									{WEEKDAYS.map((d, i) => {
										const active = (rule.byweekday ?? []).includes(d.int);
										return (
											<button
												key={`${d.int}-${i}`}
												type="button"
												onClick={() => toggleWeekday(d.int)}
												className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors ${
													active
														? "bg-primary text-white"
														: "bg-gray-100 text-gray-600 hover:bg-gray-200"
												}`}
											>
												{d.label}
											</button>
										);
									})}
								</div>
							</div>
						)}

						{/* Ends */}
						<div>
							<p className="mb-1.5 text-xs font-medium text-gray-500">Ends</p>
							<div className="space-y-2 text-sm">
								<label className="flex items-center gap-2">
									<input
										type="radio"
										checked={rule.ends.type === "never"}
										onChange={() => patch({ ends: { type: "never" } })}
										className="accent-primary"
									/>
									Never
								</label>
								<label className="flex items-center gap-2">
									<input
										type="radio"
										checked={rule.ends.type === "on"}
										onChange={() =>
											patch({
												ends: {
													type: "on",
													date: format(startDate, "yyyy-MM-dd"),
												},
											})
										}
										className="accent-primary"
									/>
									On
									<input
										type="date"
										disabled={rule.ends.type !== "on"}
										value={rule.ends.type === "on" ? rule.ends.date : ""}
										onChange={(e) =>
											patch({ ends: { type: "on", date: e.target.value } })
										}
										className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-primary focus:outline-none disabled:opacity-50"
									/>
								</label>
								<label className="flex items-center gap-2">
									<input
										type="radio"
										checked={rule.ends.type === "after"}
										onChange={() =>
											patch({ ends: { type: "after", count: 10 } })
										}
										className="accent-primary"
									/>
									After
									<input
										type="number"
										min={1}
										max={365}
										disabled={rule.ends.type !== "after"}
										value={rule.ends.type === "after" ? rule.ends.count : ""}
										onChange={(e) =>
											patch({
												ends: {
													type: "after",
													count: Math.max(1, Number(e.target.value) || 1),
												},
											})
										}
										className="w-16 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-primary focus:outline-none disabled:opacity-50"
									/>
									occurrences
								</label>
							</div>
						</div>

						<p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
							{summary}
						</p>
					</div>

					<div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
						<button
							type="button"
							onClick={onClose}
							className="rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={() => onSave(built)}
							className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
						>
							Done
						</button>
					</div>
				</div>
			</div>
		</ModalPortal>
	);
}
