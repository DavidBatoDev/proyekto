// web/src/components/time/page/TimeTabs.tsx
//
// The Time page's two tabs, under the title: "My time | Approvals (N)".
// Approvals shows only to someone who can approve in the open workspace.
// Full width and scrollable on phones.

import { cn } from "@/lib/utils";

export type TimeTab = "mine" | "approvals";

export const TIME_TABS_COPY = {
	mine: "My time",
	approvals: "Approvals",
	label: "Time views",
} as const;

/** "Approvals (3)", "Approvals" at 0. */
export function approvalsTabText(count: number): string {
	return count > 0
		? `${TIME_TABS_COPY.approvals} (${count})`
		: TIME_TABS_COPY.approvals;
}

/**
 * The tab in view: `?tab=approvals` when the person can approve; otherwise,
 * with no tab in the URL, Approvals for someone who can approve but has no
 * time of their own here, or arrives through `#waiting` with something
 * waiting; My time for everyone else.
 */
export function resolveTimeTab(input: {
	requested?: TimeTab | null;
	canApprove: boolean;
	hasOwnTime: boolean;
	waitingHere: number;
	hash?: string | null;
}): TimeTab {
	if (!input.canApprove) return "mine";
	if (input.requested) return input.requested;
	if (input.hash === "waiting" && input.waitingHere > 0) return "approvals";
	return input.hasOwnTime ? "mine" : "approvals";
}

export interface TimeTabsProps {
	value: TimeTab;
	approvalsCount: number;
	onChange: (tab: TimeTab) => void;
	className?: string;
}

export function TimeTabs({
	value,
	approvalsCount,
	onChange,
	className,
}: TimeTabsProps) {
	const tabs: { key: TimeTab; label: string }[] = [
		{ key: "mine", label: TIME_TABS_COPY.mine },
		{ key: "approvals", label: approvalsTabText(approvalsCount) },
	];
	return (
		<div
			role="tablist"
			aria-label={TIME_TABS_COPY.label}
			data-testid="time-tabs"
			className={cn(
				"hide-scrollbar -mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0",
				className,
			)}
		>
			{tabs.map((tab) => {
				const active = tab.key === value;
				return (
					<button
						key={tab.key}
						type="button"
						role="tab"
						aria-selected={active}
						data-testid={`time-tab-${tab.key}`}
						onClick={() => onChange(tab.key)}
						className={cn(
							"-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 max-sm:min-h-10 max-sm:flex-1",
							active
								? "border-primary text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						{tab.label}
					</button>
				);
			})}
		</div>
	);
}
