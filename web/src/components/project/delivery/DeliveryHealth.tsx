import { CalendarClock, LayoutGrid, Rows3 } from "lucide-react";
import type { Deliverable } from "@/services/delivery.service";
import {
	DELIVERABLE_STATUS_LABEL,
	type DeliveryStats,
	upcomingDeliveries,
} from "./deliveryModel";

export type DeliveryViewMode = "overview" | "pipeline";

const VIEW_OPTIONS: Array<{
	key: DeliveryViewMode;
	label: string;
	icon: typeof Rows3;
}> = [
	{ key: "overview", label: "Overview", icon: Rows3 },
	{ key: "pipeline", label: "Pipeline", icon: LayoutGrid },
];

/**
 * Which surface's toggle is being remembered. Deliverables and Change Requests
 * both have an Overview/Pipeline switch and must not share one stored value —
 * picking Pipeline on one should not silently flip the other.
 */
export type DeliverySurface = "deliverables" | "changeRequests";

const storageKey = (surface: DeliverySurface, projectId: string) =>
	`${surface}View:${projectId}`;

/** Mirrors the `TimeViewToggle` persistence idiom, including its try/catch. */
export function loadDeliveryView(
	projectId: string,
	surface: DeliverySurface = "deliverables",
): DeliveryViewMode {
	try {
		const stored = localStorage.getItem(storageKey(surface, projectId));
		// "list" was a third mode that shipped and was removed; anyone who left it
		// selected lands back on Overview rather than a blank page.
		if (stored === "pipeline" || stored === "overview") return stored;
	} catch {
		// Private browsing or a blocked store — the default is fine.
	}
	return "overview";
}

export function storeDeliveryView(
	projectId: string,
	mode: DeliveryViewMode,
	surface: DeliverySurface = "deliverables",
) {
	try {
		localStorage.setItem(storageKey(surface, projectId), mode);
	} catch {
		// Non-fatal: the toggle still works for this session.
	}
}

export function DeliveryViewToggle({
	value,
	onChange,
}: {
	value: DeliveryViewMode;
	onChange: (mode: DeliveryViewMode) => void;
}) {
	return (
		<div className="inline-flex rounded-lg bg-muted p-1">
			{VIEW_OPTIONS.map((option) => {
				const Icon = option.icon;
				const selected = value === option.key;
				return (
					<button
						key={option.key}
						type="button"
						onClick={() => onChange(option.key)}
						className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
							selected
								? "bg-card text-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						<Icon className="h-3.5 w-3.5" />
						{option.label}
					</button>
				);
			})}
		</div>
	);
}

/**
 * One big number with its caption. Shared with `ChangeRequestHealth`, so the two
 * delivery headers read as one system rather than two inventions.
 *
 * `value` accepts a string as well as a number: some of these are day deltas
 * ("+18") where the sign carries the meaning and must not be lost to formatting.
 */
export function StatBlock({
	value,
	label,
	tone,
}: {
	value: number | string;
	label: string;
	tone?: "warn" | "good";
}) {
	return (
		<div>
			<p
				className={`text-3xl font-semibold tracking-tight ${
					tone === "warn"
						? "text-warning"
						: tone === "good"
							? "text-success"
							: "text-foreground"
				}`}
			>
				{value}
			</p>
			<p className="mt-1 whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
				{label}
			</p>
		</div>
	);
}

/**
 * Delivery health.
 *
 * States what the number *means* — "72% of planned deliverables have been
 * accepted" — rather than a bare "72% complete", which invites the reader to
 * assume it measures effort or time.
 */
export function DeliveryHealth({
	stats,
	deliverables,
}: {
	stats: DeliveryStats;
	deliverables: Deliverable[];
}) {
	const upcoming = upcomingDeliveries(deliverables, 4);

	return (
		// Deliberately unboxed: the health numbers are page furniture, not a
		// separate object, and a card around them competes with the deliverable
		// cards below for "this is a thing".
		<div className="mb-8 border-b border-border px-1 pb-8">
			<div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-12">
				<div>
					<div className="flex items-baseline gap-3">
						<span className="text-5xl font-semibold tracking-tight text-foreground">
							{stats.acceptedPercent === null
								? "—"
								: `${stats.acceptedPercent}%`}
						</span>
						<span className="text-sm text-muted-foreground">
							{stats.acceptedPercent === null
								? "Nothing planned yet"
								: "of planned deliverables have been accepted"}
						</span>
					</div>

					<div className="mt-4 h-2 max-w-3xl overflow-hidden rounded-full bg-muted">
						<div
							className="h-full rounded-full bg-success transition-all duration-500"
							style={{ width: `${stats.acceptedPercent ?? 0}%` }}
						/>
					</div>

					<div className="mt-7 flex flex-wrap gap-x-12 gap-y-5">
						<StatBlock value={stats.accepted} label="Accepted" tone="good" />
						<StatBlock value={stats.inReview} label="In review" />
						<StatBlock value={stats.inProgress} label="In progress" />
						<StatBlock
							value={stats.changesRequested}
							label="Changes requested"
							tone={stats.changesRequested > 0 ? "warn" : undefined}
						/>
						<StatBlock value={stats.notStarted} label="Not started" />
					</div>
				</div>

				<div className="lg:border-l lg:border-border lg:pl-12">
					<p className="mb-4 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
						<CalendarClock className="h-3.5 w-3.5" />
						Upcoming deliveries
					</p>
					{upcoming.length === 0 ? (
						<p className="text-xs text-muted-foreground">
							Nothing with a due date is outstanding.
						</p>
					) : (
						<ul className="space-y-3.5">
							{upcoming.map((deliverable) => (
								<li key={deliverable.id} className="relative pl-4">
									<span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-primary" />
									<p className="truncate text-sm text-foreground">
										{deliverable.title}
									</p>
									<p className="text-[11px] text-muted-foreground">
										{deliverable.due_date} ·{" "}
										{DELIVERABLE_STATUS_LABEL[deliverable.status]}
									</p>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	);
}
