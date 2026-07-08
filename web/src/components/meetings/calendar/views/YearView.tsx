import { useMemo } from "react";
import type { Meeting } from "@/services/meetings.service";
import { MiniMonth } from "../MiniMonth";

interface YearViewProps {
	anchor: Date;
	meetings: Meeting[];
	now: Date;
	onOpenDay: (day: Date) => void;
}

export function YearView({ anchor, meetings, now, onOpenDay }: YearViewProps) {
	const year = anchor.getFullYear();
	const months = useMemo(
		() => Array.from({ length: 12 }, (_, m) => new Date(year, m, 1)),
		[year],
	);

	return (
		<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{months.map((month) => (
				<MiniMonth
					key={month.getMonth()}
					month={month}
					meetings={meetings}
					now={now}
					onOpenDay={onOpenDay}
				/>
			))}
		</div>
	);
}
