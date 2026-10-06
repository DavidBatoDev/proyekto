import { LayoutList, ListChecks, Tag, Users } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { FilterSelect } from "@/components/team-time/FilterSelect";
import {
	buildCustomPeriodFromDateInputs,
	currentPayPeriod,
	type LogPeriodPreset,
	normalizePayPeriodConfig,
	resolvePayPeriods,
	type TeamLogResolvedPeriod,
} from "@/components/team-time/log-period";
import { TeamLogsPeriodFilter } from "@/components/team-time/TeamLogsPeriodFilter";
import { isNativeApp } from "@/lib/platform";
import {
	TIME_REPORT_STATUSES,
	type TimeReportForKind,
	type TimeReportGroup,
	type TimeReportStatus,
} from "@/lib/timeSearch";
import type { PayPeriodConfig } from "@/services/teams.service";
import {
	matchPreset,
	presetRange,
	type RangeContext,
	REPORT_COPY,
	REPORT_FOR_LABEL,
	REPORT_GROUP_LABEL,
	REPORT_STATUS_LABEL,
	type ReportPersonOption,
	type ReportPreset,
	type ReportRange,
} from "./reportModel";

/**
 * The report's filter row (ux.md › Reports: range in the scope's policy
 * timezone, person, For, status; group by person, project, task, day, week).
 * Each control renders only when its options are given, so a mount shows just
 * what fits its scope (a team report has no For filter; the client view has
 * none of them). The range picker is the team pages' `TeamLogsPeriodFilter`,
 * fed local dates; presets are counted in the scope's timezone and week.
 */
export interface ReportFiltersProps {
	range: ReportRange;
	onRangeChange: (range: ReportRange) => void;
	/** The scope's policy timezone (presets are counted in it). */
	timezone: string;
	/** ISO week start for "This week" (1 = Monday). */
	weekStart?: number | null;
	/** Offers the team's pay cut-offs in the range picker. Never on native. */
	cutoffs?: { config: PayPeriodConfig | null } | null;
	/** People to filter to; omitted or null hides the filter. */
	people?: readonly ReportPersonOption[] | null;
	person?: string;
	onPersonChange?: (person: string | undefined) => void;
	/** For kinds to offer; empty or omitted hides the filter. */
	forKinds?: readonly TimeReportForKind[];
	forKind?: TimeReportForKind;
	onForChange?: (kind: TimeReportForKind | undefined) => void;
	showStatus?: boolean;
	status?: TimeReportStatus;
	onStatusChange?: (status: TimeReportStatus | undefined) => void;
	/** Groupings to offer; empty or omitted hides the control. */
	groups?: readonly TimeReportGroup[];
	group?: TimeReportGroup;
	onGroupChange?: (group: TimeReportGroup) => void;
	/** Before the range (a view switch such as Everyone · Client hours). */
	leading?: ReactNode;
	/** At the end of the row (the Export button). */
	trailing?: ReactNode;
	now?: Date;
}

/** A local `YYYY-MM-DD` for a browser-local Date (the pay-period helpers' dates). */
function ymd(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

function cutoffMatch(
	range: ReportRange,
	config: PayPeriodConfig | null,
): { month: string; periodId: string; payDateIso: string } | null {
	const month = range.from.slice(0, 7);
	for (const period of resolvePayPeriods(config, month)) {
		if (ymd(period.from) === range.from && ymd(period.to) === range.to) {
			return {
				month,
				periodId: period.id,
				payDateIso: period.payDate.toISOString(),
			};
		}
	}
	return null;
}

/** The picker's own period shape, built from local dates. */
export function pickerPeriod(
	range: ReportRange,
	ctx: RangeContext,
	cutoffConfig?: PayPeriodConfig | null,
): TeamLogResolvedPeriod {
	const preset = matchPreset(range, ctx);
	const cutoff =
		cutoffConfig !== undefined ? cutoffMatch(range, cutoffConfig) : null;
	const bounds = buildCustomPeriodFromDateInputs(range.from, range.to);
	return {
		preset: preset ?? (cutoff ? "cutoff" : "custom"),
		fromIso: bounds?.fromIso ?? "",
		toIso: bounds?.toIso ?? "",
		customFromDate: range.from,
		customToDate: range.to,
		cutoffMonth: cutoff?.month ?? range.from.slice(0, 7),
		cutoffPeriodId:
			cutoff?.periodId ??
			normalizePayPeriodConfig(cutoffConfig ?? null).periods[0].id,
		payDateIso: cutoff?.payDateIso ?? null,
	};
}

const PICKER_PRESETS = new Set<string>([
	"this_week",
	"this_month",
	"this_year",
	"all_time",
]);

export function ReportFilters({
	range,
	onRangeChange,
	timezone,
	weekStart,
	cutoffs,
	people,
	person,
	onPersonChange,
	forKinds,
	forKind,
	onForChange,
	showStatus = false,
	status,
	onStatusChange,
	groups,
	group,
	onGroupChange,
	leading,
	trailing,
	now,
}: ReportFiltersProps) {
	const native = isNativeApp();
	const showCutoffs = Boolean(cutoffs) && !native;
	const config = cutoffs?.config ?? null;
	const ctx: RangeContext = useMemo(
		() => ({ timezone, weekStart, now }),
		[timezone, weekStart, now],
	);
	const period = useMemo(
		() => pickerPeriod(range, ctx, showCutoffs ? config : undefined),
		[range, ctx, showCutoffs, config],
	);

	const cutoffRange = (month: string, periodId: string) => {
		const periods = resolvePayPeriods(config, month);
		const chosen = periods.find((p) => p.id === periodId) ?? periods[0];
		if (chosen) onRangeChange({ from: ymd(chosen.from), to: ymd(chosen.to) });
	};

	const onPresetChange = (preset: LogPeriodPreset) => {
		if (preset === "current_cutoff") {
			const current = currentPayPeriod(config, now ?? new Date());
			onRangeChange({
				from: ymd(current.period.from),
				to: ymd(current.period.to),
			});
			return;
		}
		if (preset === "cutoff") {
			cutoffRange(period.cutoffMonth, period.cutoffPeriodId);
			return;
		}
		if (PICKER_PRESETS.has(preset)) {
			onRangeChange(presetRange(preset as ReportPreset, ctx));
		}
	};

	const personOptions = useMemo(() => {
		if (!people) return null;
		const list = people.map((p) => ({
			value: p.id,
			label: p.label,
			...(p.avatarUrl !== undefined ? { avatarUrl: p.avatarUrl } : {}),
		}));
		if (person && !list.some((p) => p.value === person)) {
			list.push({ value: person, label: REPORT_COPY.selectedPerson });
		}
		return [{ value: "", label: REPORT_COPY.allPeople }, ...list];
	}, [people, person]);

	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
			{leading}
			<TeamLogsPeriodFilter
				period={period}
				payPeriodConfig={config}
				showCutoffs={showCutoffs}
				onPresetChange={onPresetChange}
				onCutoffMonthChange={(month) =>
					cutoffRange(month, period.cutoffPeriodId)
				}
				onCutoffPeriodChange={(periodId) =>
					cutoffRange(period.cutoffMonth, periodId)
				}
				onApplyCustomRange={(from, to) =>
					onRangeChange(from <= to ? { from, to } : { from: to, to: from })
				}
			/>
			{personOptions && onPersonChange ? (
				<FilterSelect
					value={person ?? ""}
					onChange={(value) => onPersonChange(value || undefined)}
					icon={<Users className="h-3.5 w-3.5" />}
					placeholder={REPORT_COPY.allPeople}
					options={personOptions}
				/>
			) : null}
			{forKinds && forKinds.length > 0 && onForChange ? (
				<FilterSelect
					value={forKind ?? ""}
					onChange={(value) =>
						onForChange((value || undefined) as TimeReportForKind | undefined)
					}
					icon={<Tag className="h-3.5 w-3.5" />}
					placeholder={REPORT_COPY.allFor}
					options={[
						{ value: "", label: REPORT_COPY.allFor },
						...forKinds.map((kind) => ({
							value: kind,
							label: REPORT_FOR_LABEL[kind],
						})),
					]}
				/>
			) : null}
			{showStatus && onStatusChange ? (
				<FilterSelect
					value={status ?? ""}
					onChange={(value) =>
						onStatusChange((value || undefined) as TimeReportStatus | undefined)
					}
					icon={<ListChecks className="h-3.5 w-3.5" />}
					placeholder={REPORT_COPY.allStatuses}
					options={[
						{ value: "", label: REPORT_COPY.allStatuses },
						...TIME_REPORT_STATUSES.map((s) => ({
							value: s,
							label: REPORT_STATUS_LABEL[s],
						})),
					]}
				/>
			) : null}
			{groups && groups.length > 0 && onGroupChange ? (
				<FilterSelect
					value={group ?? groups[0]}
					onChange={(value) => onGroupChange(value as TimeReportGroup)}
					icon={<LayoutList className="h-3.5 w-3.5" />}
					placeholder={REPORT_GROUP_LABEL[groups[0]]}
					options={groups.map((g) => ({
						value: g,
						label: REPORT_GROUP_LABEL[g],
					}))}
				/>
			) : null}
			{trailing ? <div className="ml-auto">{trailing}</div> : null}
		</div>
	);
}
