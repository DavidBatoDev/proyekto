// web/src/components/time/page/TimeSummaryCards.tsx
//
// The My time tab's summary row, over the FILTERED entries (dates, project,
// For, search and status):
//
//   ┌ Total hours ┐ ┌ Entries ┐ ┌ Days logged ┐ ┌ Avg / day ┐ ┌ Amount ┐
//   │ 34.75       │ │ 12      │ │ 5           │ │ 6.95      │ │ PHP …  │
//
// - Total hours: decimal, two places (the sheet's own format).
// - Days logged: distinct local days (in the view's timezone) with an entry.
// - Avg / day: total ÷ days logged.
// - Amount: only when the table's money rule lets an amount show (the
//   viewer's cost is visible, never agreement time on native, and there is
//   an amount); otherwise the card is not rendered at all. One line per
//   currency, never summed across currencies.
//
// Five cards in a row on desktop, a two-column grid below 640 px. No
// approval-specific cards.

import { memo, type ReactNode } from "react";
import { isNativeApp } from "@/lib/platform";
import { serverNow } from "@/lib/serverClock";
import { canShowAmounts } from "@/lib/timeFormat";
import { cn } from "@/lib/utils";
import type { TimeEntryView } from "@/services/time.types";
import { AmountLines } from "../entries/AmountLines";
import {
	entryAmount,
	entryDayKey,
	entryWorkSeconds,
} from "../entries/entryRules";
import { formatDecimalHours } from "../entries/TimeEntriesTable";
import { useLiveNowMs } from "../timer/liveDuration";

export const TIME_SUMMARY_COPY = {
	region: "Summary",
	totalHours: "Total hours",
	entries: "Entries",
	daysLogged: "Days logged",
	avgPerDay: "Avg / day",
	amount: "Amount",
} as const;

export interface TimeSummary {
	seconds: number;
	entries: number;
	days: number;
	/** Total ÷ days logged (0 with no day). */
	avgSeconds: number;
	/** Per currency, or null when no amount may show (the card is hidden). */
	amounts: Record<string, number> | null;
	/** The first entry that may show money (AmountLines' cost and kind). */
	amountSource: Pick<TimeEntryView, "cost" | "context_kind"> | null;
}

/** The summary of the entries shown. */
export function timeSummary(
	entries: readonly TimeEntryView[],
	options: { timeZone: string; nowMs?: number; native?: boolean },
): TimeSummary {
	const native = options.native ?? isNativeApp();
	const nowMs = options.nowMs ?? serverNow();
	let seconds = 0;
	const days = new Set<string>();
	const amounts: Record<string, number> = {};
	let amountSource: TimeSummary["amountSource"] = null;
	for (const entry of entries) {
		seconds += entryWorkSeconds(entry, nowMs);
		const day = entryDayKey(entry, options.timeZone);
		if (day) days.add(day);
		if (
			!canShowAmounts({ cost: entry.cost, kind: entry.context_kind, native })
		) {
			continue;
		}
		const amount = entryAmount(entry, nowMs);
		if (!amount) continue;
		amountSource ??= entry;
		amounts[amount.currency] = (amounts[amount.currency] ?? 0) + amount.amount;
	}
	const dayCount = days.size;
	return {
		seconds,
		entries: entries.length,
		days: dayCount,
		avgSeconds: dayCount > 0 ? seconds / dayCount : 0,
		amounts: amountSource
			? Object.fromEntries(
					Object.entries(amounts).map(([currency, value]) => [
						currency,
						Math.round(value * 100) / 100,
					]),
				)
			: null,
		amountSource,
	};
}

export interface TimeSummaryCardsProps {
	entries: readonly TimeEntryView[];
	timeZone: string;
	loading?: boolean;
	/** Tests: a fixed clock. */
	nowMs?: number;
	native?: boolean;
	className?: string;
}

export const TimeSummaryCards = memo(function TimeSummaryCards({
	entries,
	timeZone,
	loading = false,
	nowMs: fixedNowMs,
	native,
	className,
}: TimeSummaryCardsProps) {
	const running = entries.some((entry) => !entry.ended_at);
	const liveNowMs = useLiveNowMs(running && fixedNowMs === undefined);
	const nowMs = fixedNowMs ?? liveNowMs;
	const isNative = native ?? isNativeApp();
	const summary = timeSummary(entries, { timeZone, nowMs, native: isNative });
	const cards: { key: string; label: string; value: ReactNode }[] = [
		{
			key: "total",
			label: TIME_SUMMARY_COPY.totalHours,
			value: formatDecimalHours(summary.seconds),
		},
		{
			key: "entries",
			label: TIME_SUMMARY_COPY.entries,
			value: String(summary.entries),
		},
		{
			key: "days",
			label: TIME_SUMMARY_COPY.daysLogged,
			value: String(summary.days),
		},
		{
			key: "avg",
			label: TIME_SUMMARY_COPY.avgPerDay,
			value: formatDecimalHours(summary.avgSeconds),
		},
	];
	if (summary.amounts && summary.amountSource) {
		cards.push({
			key: "amount",
			label: TIME_SUMMARY_COPY.amount,
			value: (
				<AmountLines
					amounts={summary.amounts}
					cost={summary.amountSource.cost}
					kind={summary.amountSource.context_kind}
					native={isNative}
					layout="stacked"
					empty="—"
				/>
			),
		});
	}
	return (
		<section
			aria-label={TIME_SUMMARY_COPY.region}
			aria-busy={loading || undefined}
			className={cn(
				"grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3",
				className,
			)}
			data-testid="time-summary"
		>
			{cards.map((card) => (
				<div
					key={card.key}
					className="min-w-0 rounded-xl border border-border bg-card px-3 py-2 sm:min-w-[8.5rem] sm:flex-1"
					data-testid={`time-summary-${card.key}`}
				>
					<p className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
						{card.label}
					</p>
					<div
						className={cn(
							"mt-0.5 text-lg font-semibold tabular-nums text-foreground",
							loading && "animate-pulse text-muted-foreground",
						)}
						data-testid={`time-summary-${card.key}-value`}
					>
						{loading ? "–" : card.value}
					</div>
				</div>
			))}
		</section>
	);
});
