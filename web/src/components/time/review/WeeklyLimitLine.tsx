// web/src/components/time/review/WeeklyLimitLine.tsx
//
// The weekly-limit line (ux.md › Approvals › Review screen):
//
//   ⏱ Weekly limit 40h (Prodigitality) · 38:15 logged · within limit
//   ⏱ Weekly limit 40h in the agreement with Acme Corp · 43:30 logged · 3:30 over
//
// On a workspace or team sheet it is an indicator only (D65): read from
// `rules.weekly_limit_minutes` and the logged total, it never says or implies
// that hours are cut, it only turns amber, and it never adds the over-the-
// limit panel. An agreement's own limit can cut payable time (L12); past it,
// the line turns red, and a decider gets OverLimitPanel instead of this line.

import { Timer } from "lucide-react";
import { limitTone } from "@/components/time/page/LimitBanner";
import { nativeSafe, weeklyLimitLine } from "@/lib/timeErrors";
import { cn } from "@/lib/utils";
import type { SheetLimitReading } from "./reviewModel";

/** The line's text, without its ⏱ icon. */
export function weeklyLimitText(reading: SheetLimitReading): string {
	return weeklyLimitLine({
		source: reading.source,
		label: reading.label,
		limitMinutes: reading.limitMinutes,
		loggedSeconds: reading.loggedSeconds,
	});
}

export type WeeklyLimitTone = "neutral" | "near" | "over" | "over_cut";

/** Amber near or past a policy limit; red past an agreement's (it cuts pay). */
export function weeklyLimitTone(reading: SheetLimitReading): WeeklyLimitTone {
	const tone = limitTone(reading);
	if (tone === "over" && reading.source === "agreement") return "over_cut";
	return tone;
}

const TONE_CLASS: Record<WeeklyLimitTone, string> = {
	neutral: "text-muted-foreground",
	near: "text-warning-foreground",
	over: "text-warning-foreground",
	over_cut: "text-destructive",
};

export interface WeeklyLimitLineProps {
	reading: SheetLimitReading;
	className?: string;
}

export function WeeklyLimitLine({ reading, className }: WeeklyLimitLineProps) {
	const tone = weeklyLimitTone(reading);
	return (
		<p
			data-testid="review-weekly-limit"
			data-tone={tone}
			className={cn(
				"flex items-start gap-2 text-sm",
				TONE_CLASS[tone],
				className,
			)}
		>
			<Timer className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
			<span className="tabular-nums">
				{nativeSafe(weeklyLimitText(reading))}
			</span>
		</p>
	);
}
