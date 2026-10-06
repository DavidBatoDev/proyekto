// web/src/components/time/page/LegacyGroupingBanner.tsx
//
// The one-time legacy grouping banner (ux.md › The Time Page › One-time cards;
// L32). Loggers whose time was moved from per-entry review into timesheets
// (a `GET /time/me/timesheets` item with `origin: 'legacy_migration'`) read,
// above the timer bar:
//
//   "Your time is now grouped into timesheets. Past weeks were sent for
//    approval for you. [Got it]"
//
// "Got it" is remembered in localStorage under `time-legacy-banner-dismissed`.
// Reads and writes are wrapped in try/catch; when storage is unavailable the
// banner simply shows again next time.

import { useQuery } from "@tanstack/react-query";
import { Layers } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { timeQueries } from "@/queries/time";
import type { TimesheetSummary } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

export const LEGACY_BANNER_STORAGE_KEY = "time-legacy-banner-dismissed";

export const LEGACY_BANNER_COPY = {
	message:
		"Your time is now grouped into timesheets. Past weeks were sent for approval for you.",
	dismiss: "Got it",
} as const;

/** True when any sheet came from the per-entry review migration. */
export function hasLegacySheets(
	sheets: readonly Pick<TimesheetSummary, "origin">[] | null | undefined,
): boolean {
	return (sheets ?? []).some((sheet) => sheet.origin === "legacy_migration");
}

export function readLegacyBannerDismissed(): boolean {
	try {
		return globalThis.localStorage?.getItem(LEGACY_BANNER_STORAGE_KEY) === "1";
	} catch {
		return false;
	}
}

export function writeLegacyBannerDismissed(): void {
	try {
		globalThis.localStorage?.setItem(LEGACY_BANNER_STORAGE_KEY, "1");
	} catch {
		// Storage unavailable: the banner shows again next time (ux.md).
	}
}

export interface LegacyGroupingBannerProps {
	/**
	 * The person's timesheets when the page already has them (an unfiltered
	 * `me/timesheets` read). Without them the banner reads `me/timesheets`
	 * itself, and only while it has not been dismissed.
	 */
	sheets?: readonly Pick<TimesheetSummary, "origin">[] | null;
	className?: string;
}

export function LegacyGroupingBanner({
	sheets,
	className,
}: LegacyGroupingBannerProps) {
	const userId = useAuthStore((state) => state.user?.id ?? null);
	const [dismissed, setDismissed] = useState(readLegacyBannerDismissed);
	const query = useQuery({
		...timeQueries.myTimesheets(userId),
		enabled: Boolean(userId) && !dismissed && sheets === undefined,
	});
	const list = sheets === undefined ? query.data : sheets;

	if (dismissed || !hasLegacySheets(list)) return null;

	return (
		<section
			role="status"
			data-testid="legacy-grouping-banner"
			className={cn(
				"flex flex-col gap-3 rounded-xl border border-l-4 border-border border-l-info bg-card px-4 py-3 sm:flex-row sm:items-center",
				className,
			)}
		>
			<div className="flex min-w-0 flex-1 items-start gap-3">
				<Layers
					className="mt-0.5 h-4 w-4 shrink-0 text-info"
					aria-hidden="true"
				/>
				<p className="min-w-0 text-sm text-foreground">
					{LEGACY_BANNER_COPY.message}
				</p>
			</div>
			<button
				type="button"
				onClick={() => {
					writeLegacyBannerDismissed();
					setDismissed(true);
				}}
				className="inline-flex h-8 shrink-0 items-center justify-center self-start whitespace-nowrap rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 max-sm:ml-7 sm:self-auto"
			>
				{LEGACY_BANNER_COPY.dismiss}
			</button>
		</section>
	);
}
