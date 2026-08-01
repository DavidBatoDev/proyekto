import { format, isToday, isYesterday } from "date-fns";
import type { ActivityEntry } from "@/services/activity.service";

export interface ActivityDayGroup {
	/** Local calendar day, `yyyy-MM-dd`. */
	key: string;
	label: string;
	items: ActivityEntry[];
}

/**
 * Group a page of activity into local calendar days.
 *
 * Two things this must NOT do:
 *
 *  - Key on `toISOString().slice(0,10)`. That is UTC, so a 9pm Manila event
 *    files under the next day and the feed shows a header for a day the user
 *    never experienced. `format` uses the local zone.
 *
 *  - Re-sort. Items arrive already ordered by the server's
 *    (created_at DESC, seq DESC) keyset; re-sorting here would desync the
 *    rendered order from the cursor and make paging look like it skipped rows.
 */
export function groupActivityByDay(items: ActivityEntry[]): ActivityDayGroup[] {
	const groups: ActivityDayGroup[] = [];

	for (const item of items) {
		const date = new Date(item.created_at);
		if (Number.isNaN(date.getTime())) continue;

		const key = format(date, "yyyy-MM-dd");
		const last = groups[groups.length - 1];
		if (last && last.key === key) {
			last.items.push(item);
			continue;
		}
		groups.push({ key, label: dayLabel(date), items: [item] });
	}

	return groups;
}

export function dayLabel(date: Date): string {
	if (isToday(date)) return "Today";
	if (isYesterday(date)) return "Yesterday";
	return format(date, "EEEE, d MMMM yyyy");
}
