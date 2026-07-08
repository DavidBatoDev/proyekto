/**
 * The red "now" indicator drawn across a day column. Positioned as a fraction
 * of the day; the parent column must be `relative`. Only render for today.
 */
import { minutesFromMidnight } from "./overlap/layout";

export function CurrentTimeLine({ now }: { now: Date }) {
	const topPct = (minutesFromMidnight(now) / (24 * 60)) * 100;
	return (
		<div
			className="pointer-events-none absolute left-0 right-0 z-20 flex items-center"
			style={{ top: `${topPct}%` }}
			aria-hidden="true"
		>
			<span className="-ml-1 h-2.5 w-2.5 rounded-full bg-red-500" />
			<span className="h-px flex-1 bg-red-500" />
		</div>
	);
}
