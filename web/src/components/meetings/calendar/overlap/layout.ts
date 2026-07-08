/**
 * Event overlap layout — the geometry engine behind the Day/Week time grids.
 *
 * Given the timed events of a single day (expressed as minutes-from-midnight),
 * it packs overlapping events into side-by-side columns the way Google Calendar
 * does: transitively-overlapping events form a cluster, each event is greedily
 * assigned to the first free column, and every event in a cluster is sized to an
 * equal share of the width. Output is returned as percentages so the grid can
 * scale it to whatever pixel height it renders at.
 *
 * Pure and deterministic — no Date/DOM access — so it is unit-testable in
 * isolation (see layout.test.ts).
 */
export interface LayoutEvent {
	id: string;
	/** Minutes from midnight. */
	start: number;
	/** Minutes from midnight; clamped to >= start. */
	end: number;
}

export interface LayoutBox {
	id: string;
	/** Vertical offset from the top of the day, as a % of the visible span. */
	topPct: number;
	/** Height as a % of the visible span. */
	heightPct: number;
	/** Horizontal offset within the day column, as a % of its width. */
	leftPct: number;
	/** Width as a % of the day column. */
	widthPct: number;
	/** 0-based column this event occupies within its overlap cluster. */
	columnIndex: number;
	/** Total columns in this event's cluster. */
	columnCount: number;
}

export interface LayoutOptions {
	/** Top of the visible day window, in minutes from midnight (default 0). */
	dayStartMin?: number;
	/** Bottom of the visible day window, in minutes from midnight (default 1440). */
	dayEndMin?: number;
}

/** Minutes-from-midnight for a Date's local clock time. */
export function minutesFromMidnight(date: Date): number {
	return date.getHours() * 60 + date.getMinutes();
}

export function layoutDay(
	events: LayoutEvent[],
	options: LayoutOptions = {},
): LayoutBox[] {
	const dayStart = options.dayStartMin ?? 0;
	const dayEnd = options.dayEndMin ?? 24 * 60;
	const span = Math.max(1, dayEnd - dayStart);
	const clamp = (n: number) => Math.min(dayEnd, Math.max(dayStart, n));

	const norm = events.map((e) => {
		const s = clamp(e.start);
		return { id: e.id, s, e: Math.max(s, clamp(e.end)) };
	});
	// Start order, longer-first on ties, keeps column packing stable.
	norm.sort((a, b) => a.s - b.s || b.e - a.e);

	const out: LayoutBox[] = [];
	let cluster: { id: string; s: number; e: number; col: number }[] = [];
	let colEnds: number[] = []; // last end time per column in the active cluster
	let clusterEnd = Number.NEGATIVE_INFINITY;

	const flush = () => {
		const columnCount = colEnds.length || 1;
		const widthPct = 100 / columnCount;
		for (const item of cluster) {
			out.push({
				id: item.id,
				topPct: ((item.s - dayStart) / span) * 100,
				heightPct: ((item.e - item.s) / span) * 100,
				leftPct: item.col * widthPct,
				widthPct,
				columnIndex: item.col,
				columnCount,
			});
		}
		cluster = [];
		colEnds = [];
		clusterEnd = Number.NEGATIVE_INFINITY;
	};

	for (const ev of norm) {
		// A new event that starts at/after everything in the cluster ends cannot
		// overlap it — close the cluster and start fresh.
		if (cluster.length && ev.s >= clusterEnd) flush();

		let col = colEnds.findIndex((end) => end <= ev.s);
		if (col === -1) {
			col = colEnds.length;
			colEnds.push(ev.e);
		} else {
			colEnds[col] = ev.e;
		}
		cluster.push({ id: ev.id, s: ev.s, e: ev.e, col });
		clusterEnd = Math.max(clusterEnd, ev.e);
	}
	if (cluster.length) flush();

	return out;
}
