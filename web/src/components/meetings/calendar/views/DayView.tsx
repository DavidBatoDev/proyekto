import type { OpenItem } from "../ItemViews";
import type { CalendarItem } from "../items";
import { TimeGrid } from "../TimeGrid";

interface DayViewProps {
	anchor: Date;
	items: CalendarItem[];
	now: Date;
	timeZoneLabel?: string;
	onOpenItem?: OpenItem;
	onCreateAt?: (at: Date) => void;
	onOpenDay?: (day: Date) => void;
}

export function DayView({ anchor, ...rest }: DayViewProps) {
	return <TimeGrid days={[anchor]} {...rest} />;
}
