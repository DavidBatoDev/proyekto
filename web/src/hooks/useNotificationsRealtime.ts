import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { invalidateTime, TIME_PREFIX, type TimeEvent } from "@/queries/time";

/**
 * What a time notification says changed (ux.md › Notifications), as the
 * `invalidateTime` events that refresh it. Timesheet notifications move a
 * sheet (the approval queue, its count, the person's cards); timer ones move
 * an entry; a recorded payment moves payouts; a comment moves one entry.
 */
export const TIME_NOTIFICATION_EVENTS: Readonly<
	Record<string, readonly TimeEvent[]>
> = {
	timesheet_submitted: ["sheet"],
	timesheet_returned: ["sheet"],
	timesheet_approved: ["sheet"],
	timesheet_reopened: ["sheet"],
	timesheet_reopen_requested: ["sheet"],
	timesheet_reminder: ["sheet"],
	timesheets_imported: ["sheet"],
	timer_running_long: ["entry"],
	timer_auto_stopped: ["entry"],
	time_payout_recorded: ["payout"],
	time_log_comment_added: ["comment"],
};

function notificationType(row: unknown): string | null {
	if (!row || typeof row !== "object") return null;
	const type = (row as { type?: unknown }).type;
	return typeof type === "string" && type ? type : null;
}

/**
 * Time-shaped types beyond the map: legacy `time_log_*` rows still in the
 * table, and any `timesheet_*` / `timer_*` type added later.
 */
const TIME_TYPE_PATTERN = /^(time_|timesheets?_|timer_)/;

/**
 * Whether a notification change can move a time cache: a time type, or no
 * type at all. A DELETE carries only the row id (a withdrawn sheet deletes
 * the deciders' notification), so an untyped change has to count.
 */
export function mayTouchTime(type: string | null): boolean {
	return (
		type === null ||
		Object.hasOwn(TIME_NOTIFICATION_EVENTS, type) ||
		TIME_TYPE_PATTERN.test(type)
	);
}

/**
 * The time caches a notification change touches. A time notification, or an
 * untyped change (see `mayTouchTime`), refreshes the time overview (the
 * sidebar's Time item and its badge) and the approval queue (the dashboard
 * card and Waiting for you); a mapped type also refreshes what its event
 * changed. Any other notification (chat, mentions, projects) touches no time
 * cache: the overview is an active query on every page, so refreshing it for
 * every notification would refetch it app-wide.
 */
export function invalidateTimeForNotification(
	queryClient: QueryClient,
	payload: { new?: unknown; old?: unknown } | null | undefined,
): Promise<unknown> {
	const type = notificationType(payload?.new) ?? notificationType(payload?.old);
	if (!mayTouchTime(type)) return Promise.resolve();
	const events =
		type && Object.hasOwn(TIME_NOTIFICATION_EVENTS, type)
			? TIME_NOTIFICATION_EVENTS[type]
			: undefined;
	return Promise.all([
		queryClient.invalidateQueries({ queryKey: TIME_PREFIX.overview }),
		queryClient.invalidateQueries({ queryKey: TIME_PREFIX.approvals }),
		events ? invalidateTime(queryClient, events) : Promise.resolve(),
	]);
}

export function useNotificationsRealtime(userId?: string | null) {
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!userId) return;

		const channel = supabase
			.channel(`notifications:${userId}`)
			.on(
				"postgres_changes",
				{
					event: "*",
					schema: "public",
					table: "notifications",
					filter: `user_id=eq.${userId}`,
				},
				(payload) => {
					void queryClient.invalidateQueries({ queryKey: ["notifications"] });
					void queryClient.invalidateQueries({
						queryKey: ["notifications", "unread-count"],
					});
					void invalidateTimeForNotification(queryClient, payload);
				},
			)
			.subscribe();

		return () => {
			void supabase.removeChannel(channel);
		};
	}, [queryClient, userId]);
}
