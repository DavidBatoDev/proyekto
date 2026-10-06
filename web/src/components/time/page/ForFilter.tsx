// web/src/components/time/page/ForFilter.tsx
//
// The page's "For: [All ▾]" filter (ux.md › The Time Page). It writes
// `?for=` (`team:<id>`, `workspace:<id>`, `assignment:<id>`, `personal`),
// which narrows the list, the cards and the month, and sets the day strip's
// timezone and week start to that context's. The options come from
// `forFilterOptions` (useTimePageData): two assignments under one agreement
// read the same, so they add their project ("Cora Villanueva · agreement ·
// Rebrand", V10).
//
// When everything the person tracks is "Just me" (the project resolver gives
// them only the personal option), there is nothing to filter: the control
// reads "For: Just me" with a Why? (P1b: "Your workspace's plan doesn't
// include timesheets; this time is just for you.").

import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { contextLabel } from "@/lib/timeFormat";
import type { TimeForParam } from "@/lib/timeSearch";
import { cn } from "@/lib/utils";
import { timeQueries } from "@/queries/time";
import type { LoggingForResult } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import type { ForFilterOption } from "./useTimePageData";
import { WhyPersonalPopover } from "./WhyPersonalPopover";

export const FOR_FILTER_COPY = {
	label: "For",
	all: "All",
} as const;

const ALL = "__all__";

export interface ForFilterProps {
	value?: TimeForParam;
	options: readonly ForFilterOption[];
	onChange: (value: TimeForParam | undefined) => void;
	/**
	 * The person can only track time for themselves: show "For: Just me" with
	 * Why? instead of a filter (see `usePersonalWhy`).
	 */
	personal?: Pick<LoggingForResult, "personal_reason" | "unavailable"> | null;
	className?: string;
}

export function ForFilter({
	value,
	options,
	onChange,
	personal,
	className,
}: ForFilterProps) {
	const id = useId();
	const governed = options.some((option) => option.kind !== "personal");

	if (personal && !governed && !value) {
		return (
			<span
				className={cn(
					"inline-flex items-center gap-1.5 text-xs text-muted-foreground",
					className,
				)}
				data-testid="for-filter-personal"
			>
				<span>{FOR_FILTER_COPY.label}:</span>
				<span className="font-semibold text-foreground">
					{contextLabel("personal", null)}
				</span>
				<WhyPersonalPopover
					reason={personal.personal_reason ?? null}
					unavailable={personal.unavailable ?? []}
				/>
			</span>
		);
	}
	if (options.length === 0) return null;

	return (
		<span className={cn("inline-flex items-center gap-1.5", className)}>
			<label htmlFor={id} className="text-xs font-medium text-muted-foreground">
				{FOR_FILTER_COPY.label}:
			</label>
			<select
				id={id}
				value={value ?? ALL}
				onChange={(event) => {
					const next = event.currentTarget.value;
					onChange(next === ALL ? undefined : (next as TimeForParam));
				}}
				className="h-8 max-w-[14rem] truncate rounded-lg border border-input bg-card px-2 text-xs font-semibold text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 max-sm:h-10"
				data-testid="for-filter"
			>
				<option value={ALL}>{FOR_FILTER_COPY.all}</option>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</span>
	);
}

/**
 * Whether the person can only track "Just me" time, and why: read from the
 * resolver of their most recently logged project (A9's first project). Only
 * asked while the overview names no team, workspace or agreement context.
 * Null while unknown, or when another option exists.
 */
export function usePersonalWhy(
	enabled: boolean,
): Pick<LoggingForResult, "personal_reason" | "unavailable"> | null {
	const userId = useAuthStore((state) => state.user?.id ?? null);
	const projects = useQuery({
		...timeQueries.myProjects(userId),
		enabled: enabled && Boolean(userId),
	});
	const projectId = projects.data?.projects?.[0]?.id ?? null;
	const loggingFor = useQuery({
		...timeQueries.loggingFor(projectId),
		enabled: enabled && Boolean(projectId),
	});
	if (!enabled) return null;
	return personalOnlyResult(loggingFor.data ?? null);
}

/** The resolver's answer when its only option is "Just me"; null otherwise. */
export function personalOnlyResult(
	result: LoggingForResult | null,
): Pick<LoggingForResult, "personal_reason" | "unavailable"> | null {
	if (!result) return null;
	const options = result.options ?? [];
	if (options.length !== 1 || options[0]?.kind !== "personal") return null;
	return {
		personal_reason: result.personal_reason,
		unavailable: result.unavailable ?? [],
	};
}
