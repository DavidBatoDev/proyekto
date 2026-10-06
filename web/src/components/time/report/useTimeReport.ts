/**
 * The report kit's queries. Every key sits under `["time", "reports", …]`, so
 * `invalidateTime(qc, 'entry' | 'sheet' | 'policy' | 'payout')` refreshes a
 * report that is on screen.
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { retryTimeQuery, timeKeys, timeQueries } from "@/queries/time";
import { listAllReportEntries } from "@/services/time.service";
import type { ReportQuery } from "@/services/time.types";
import { REPORT_ENTRIES_CAP, type ReportFilterQuery } from "./reportModel";

function hasRange(query: ReportFilterQuery): boolean {
	return Boolean(query.scope.id && query.from && query.to);
}

/** `reports/summary` for one grouping. */
export function useReportSummary(query: ReportQuery, enabled = true) {
	return useQuery({
		...timeQueries.reportSummary(query),
		enabled: enabled && hasRange(query),
	});
}

/** One page of `reports/entries`; the previous page stays on screen while the next loads. */
export function useReportEntriesPage(query: ReportQuery, enabled = true) {
	return useQuery({
		...timeQueries.reportEntries(query),
		enabled: enabled && hasRange(query),
		placeholderData: keepPreviousData,
	});
}

/** Every entry of a report, up to the 10,000 cap (the sections view). */
export function useAllReportEntries(
	filters: ReportFilterQuery,
	enabled = true,
) {
	return useQuery({
		queryKey: [...timeKeys.reportEntries(filters), "all"] as const,
		queryFn: () =>
			listAllReportEntries(filters, { maxItems: REPORT_ENTRIES_CAP }),
		enabled: enabled && hasRange(filters),
		refetchOnMount: true,
		retry: retryTimeQuery,
	});
}
