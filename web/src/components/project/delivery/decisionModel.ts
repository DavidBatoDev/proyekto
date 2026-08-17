import {
	Briefcase,
	Cpu,
	Crosshair,
	Database,
	type LucideIcon,
	Palette,
	Shield,
	Tag,
	Workflow,
} from "lucide-react";
import type {
	CategoryColor,
	CategoryIcon,
	Decision,
	DecisionCategory,
	DecisionLink,
} from "@/services/delivery.service";
import type { StatusTone } from "./DeliveryPrimitives";
import type { LinkSegment, RoadmapNodeKind } from "./deliveryModel";

/**
 * Presentation rules for decisions, kept out of the components so they are
 * testable and stated once — the same split as `deliveryModel.ts` and
 * `changeRequestModel.ts`.
 */

export const DECISION_STATUS_LABEL: Record<Decision["status"], string> = {
	proposed: "Proposed",
	final: "Final",
	superseded: "Superseded",
};

export const DECISION_STATUS_TONE: Record<Decision["status"], StatusTone> = {
	proposed: "review",
	final: "good",
	// Not "bad": a superseded decision was not a mistake, it was replaced. The
	// tone that says "this is no longer live" is the neutral one.
	superseded: "neutral",
};

/**
 * A category's colour and icon, resolved from stored KEYS rather than stored
 * values.
 *
 * The indirection is the point. `web/src/types/label.ts` stores 30 raw hex
 * constants and paints them with `style={{backgroundColor}}`, which is what
 * breaks in dark mode; the delivery surfaces were rebuilt specifically to escape
 * that. Where no named token exists, an explicit `dark:` variant stands in —
 * the same compromise `ActivityRow`'s tone map already makes.
 */
export const CATEGORY_ACCENT: Record<CategoryColor, string> = {
	slate: "bg-muted text-muted-foreground",
	blue: "bg-info/10 text-info",
	emerald: "bg-success/10 text-success",
	amber: "bg-warning/10 text-warning",
	rose: "bg-destructive/10 text-destructive",
	violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
	teal: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
	indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
};

/** The swatch in the category editor — a solid dot, so it reads as a colour. */
export const CATEGORY_SWATCH: Record<CategoryColor, string> = {
	slate: "bg-muted-foreground",
	blue: "bg-info",
	emerald: "bg-success",
	amber: "bg-warning",
	rose: "bg-destructive",
	violet: "bg-violet-500",
	teal: "bg-teal-500",
	indigo: "bg-indigo-500",
};

export const CATEGORY_COLORS: readonly CategoryColor[] = [
	"slate",
	"blue",
	"violet",
	"teal",
	"amber",
	"rose",
	"emerald",
	"indigo",
];

export const CATEGORY_ICON: Record<CategoryIcon, LucideIcon> = {
	tag: Tag,
	cpu: Cpu,
	palette: Palette,
	crosshair: Crosshair,
	briefcase: Briefcase,
	workflow: Workflow,
	shield: Shield,
	database: Database,
};

export const CATEGORY_ICONS: readonly CategoryIcon[] = [
	"tag",
	"cpu",
	"palette",
	"crosshair",
	"briefcase",
	"workflow",
	"shield",
	"database",
];

/**
 * Suggested categories, offered as chips in the picker.
 *
 * Client-side on purpose. Seeding rows per project is an experiment this
 * codebase already ran and reversed — `chat_rooms.system_key` lasted one day
 * before the default channels became presets in `channelSuggestions.ts`. Picking
 * one of these creates an ordinary category row; a project that never opens the
 * picker has none at all.
 */
export const CATEGORY_PRESETS: ReadonlyArray<{
	name: string;
	color: CategoryColor;
	icon: CategoryIcon;
}> = [
	{ name: "Product", color: "violet", icon: "crosshair" },
	{ name: "Technical", color: "blue", icon: "cpu" },
	{ name: "Design", color: "teal", icon: "palette" },
	{ name: "Scope", color: "amber", icon: "tag" },
	{ name: "Business", color: "emerald", icon: "briefcase" },
	{ name: "Process", color: "indigo", icon: "workflow" },
];

/** "DEC-024". A null reference is an unsaved optimistic row. */
export function decisionReference(decision: Decision): string {
	if (!decision.reference) return "DEC-—";
	return `DEC-${String(decision.reference).padStart(3, "0")}`;
}

export interface DecisionStats {
	total: number;
	proposed: number;
	final: number;
	superseded: number;
	/** Final decisions that point at no work — the log's blind spot. */
	unlinked: number;
	/** Share of live decisions that are settled, 0-100, or null if none. */
	finalPercent: number | null;
	lastDecidedOn: string | null;
}

export function summarizeDecisions(decisions: Decision[]): DecisionStats {
	const count = (status: Decision["status"]) =>
		decisions.filter((d) => d.status === status).length;

	const proposed = count("proposed");
	const final = count("final");
	const superseded = count("superseded");

	// Superseded rows are history and are excluded from the denominator: a
	// healthy long-running project accumulates them, and counting them as
	// unsettled would make the headline fall as the log gets better.
	const live = proposed + final;

	return {
		total: decisions.length,
		proposed,
		final,
		superseded,
		unlinked: decisions.filter(
			(d) => d.status !== "superseded" && (d.links?.length ?? 0) === 0,
		).length,
		finalPercent: live === 0 ? null : Math.round((final / live) * 100),
		lastDecidedOn:
			decisions
				.filter((d) => d.status === "final")
				.map((d) => d.decided_on)
				.sort()
				.at(-1) ?? null,
	};
}

/**
 * What the header's "Needs attention" column lists.
 *
 * Proposed decisions first and oldest-first within that: the column exists to
 * surface what has been sitting, and newest-first would bury exactly that. Then
 * final decisions nobody linked to any work, which are the ones that will be
 * unfindable when someone asks "what did we decide about this feature?".
 */
export function needsAttention(decisions: Decision[], limit = 4): Decision[] {
	const stale = decisions
		.filter((d) => d.status === "proposed")
		.sort((a, b) => a.updated_at.localeCompare(b.updated_at));
	const unlinked = decisions
		.filter((d) => d.status === "final" && (d.links?.length ?? 0) === 0)
		.sort((a, b) => b.decided_on.localeCompare(a.decided_on));
	return [...stale, ...unlinked].slice(0, limit);
}

/** Whole days a proposed decision has been open, for the "N days" caption. */
export function daysOpen(decision: Decision, now = Date.now()): number {
	const since = Date.parse(decision.updated_at);
	if (Number.isNaN(since)) return 0;
	return Math.max(0, Math.floor((now - since) / 86_400_000));
}

/**
 * The Epic → Feature → Task trail a link came from, each segment keeping its
 * kind so the UI can give it the roadmap's own glyph.
 *
 * The decision variant of `linkSegments`: this junction can target any of the
 * five, so it handles epics and milestones as well as deliverables.
 */
export function decisionLinkSegments(link: DecisionLink): LinkSegment[] {
	const segment = (
		kind: RoadmapNodeKind,
		title: string | undefined | null,
	): LinkSegment[] => (title ? [{ kind, title }] : []);

	if (link.task) {
		return [
			...segment("epic", link.task.feature?.epic?.title),
			...segment("feature", link.task.feature?.title),
			...segment("task", link.task.title),
		];
	}
	if (link.feature) {
		return [
			...segment("epic", link.feature.epic?.title),
			...segment("feature", link.feature.title),
		];
	}
	if (link.epic) return segment("epic", link.epic.title);
	if (link.milestone) return segment("milestone", link.milestone.title);
	// A deliverable is not a roadmap node; it borrows the feature glyph so the row
	// still reads as a linked thing rather than rendering unlabelled.
	if (link.deliverable) return segment("feature", link.deliverable.title);
	return [];
}

/** The option that was chosen, if one has been marked. */
export function selectedOption(decision: Decision) {
	return decision.options?.find((option) => option.is_selected) ?? null;
}

/** Category counts for the filter row, in the categories' own order. */
export function categoryCounts(
	decisions: Decision[],
	categories: DecisionCategory[],
): Array<{ category: DecisionCategory; count: number }> {
	return categories.map((category) => ({
		category,
		count: decisions.filter((d) => d.category_id === category.id).length,
	}));
}

/** How many decisions carry no category — the "Uncategorised" chip. */
export function uncategorizedCount(decisions: Decision[]): number {
	return decisions.filter((d) => !d.category_id).length;
}
