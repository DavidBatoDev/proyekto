// web/src/components/time/for/forOptions.ts
//
// Pure logic behind the For chip and picker (ux.md › For Chip). No React, no
// copy (that is forCopy.ts).
//
// What the resolver answers (`GET /time/projects/:id/logging-for`) already
// has the collapse applied (README › Resolver step 7b): `options` are the
// distinct choices, `selected` is set only when one is left, and `prefill` is
// the remembered default awaiting one tap (L38). The web never applies the
// prefill silently: it preselects it and the person confirms.

import type {
	ContextKind,
	LoggingForRequest,
	LoggingForResult,
	LoggingOption,
	TimeEntryView,
	UnavailableOption,
} from "@/services/time.types";

/** Chips cut labels at 22 characters, cards at 32 (ux.md › Chip details). */
export const CHIP_LABEL_MAX = 22;
export const CARD_LABEL_MAX = 32;

/**
 * How a project's For choice behaves:
 * - `none`: no option (no `time.log`); the project is absent from pickers and
 *   timer buttons are not rendered.
 * - `single`: one option, picked automatically, never asked; the chip is
 *   read-only.
 * - `choose`: several and nothing remembered: a radio list, agreements first,
 *   "Use for new time on this project" ticked.
 * - `confirm`: several with a remembered default, preselected; the primary
 *   button names it so one tap confirms.
 */
export type ForMode = "none" | "single" | "choose" | "confirm";

/** The smallest shape a chip needs; an entry's context fits it too. */
export interface ForChipOption {
	kind: ContextKind;
	id: string | null;
	label: string;
	workspace_tag?: string | null;
	approver_hint?: LoggingOption["approver_hint"];
	engagement_id?: string | null;
}

export function forMode(
	result: Pick<LoggingForResult, "options" | "selected" | "prefill"> | null,
): ForMode {
	const options = result?.options ?? [];
	if (options.length === 0) return "none";
	if (options.length === 1) return "single";
	if (result?.selected) return "single";
	return result?.prefill ? "confirm" : "choose";
}

/** A stable key for an option (`team:<id>`, `personal:`). */
export function forOptionKey(
	option: Pick<LoggingForRequest, "kind" | "id"> | null | undefined,
): string {
	if (!option) return "";
	if (option.kind === "personal") return "personal:";
	return `${option.kind}:${(option.id ?? "").toLowerCase()}`;
}

/** Same choice (kind and id; ids compared case-insensitively). */
export function isSameFor(
	a: Pick<LoggingForRequest, "kind" | "id"> | null | undefined,
	b: Pick<LoggingForRequest, "kind" | "id"> | null | undefined,
): boolean {
	if (!a || !b) return false;
	return forOptionKey(a) === forOptionKey(b);
}

/** The write body's `logging_for` for an option. */
export function toForRequest(
	option: Pick<LoggingOption, "kind" | "id">,
): LoggingForRequest {
	return option.kind === "personal"
		? { kind: "personal", id: null }
		: { kind: option.kind, id: option.id };
}

const KIND_ORDER: Record<ContextKind, number> = {
	assignment: 0,
	team: 1,
	workspace: 2,
	personal: 3,
};

/** Agreements first, then teams, the workspace and Just me; server order kept within a kind. */
export function sortForOptions<T extends { kind: ContextKind }>(
	options: readonly T[],
): T[] {
	return options
		.map((option, index) => ({ option, index }))
		.sort(
			(a, b) =>
				KIND_ORDER[a.option.kind] - KIND_ORDER[b.option.kind] ||
				a.index - b.index,
		)
		.map(({ option }) => option);
}

/** Unavailable options, ordered like the options (greyed in the menu). */
export function sortUnavailable(
	unavailable: readonly UnavailableOption[] | null | undefined,
): UnavailableOption[] {
	return sortForOptions(unavailable ?? []);
}

/** The option to preselect: the selected one, else the remembered prefill, else nothing. */
export function preselectedOption(
	result: Pick<LoggingForResult, "options" | "selected" | "prefill"> | null,
): LoggingOption | null {
	if (!result) return null;
	const pick = result.selected ?? result.prefill;
	if (!pick) return null;
	return result.options.find((o) => isSameFor(o, pick)) ?? pick;
}

/**
 * "Use for new time on this project": ticked the first time (nothing
 * remembered); afterwards only when the person picks something other than
 * the remembered option.
 */
export function defaultRemember(
	result: Pick<LoggingForResult, "prefill"> | null,
	chosen: Pick<LoggingOption, "kind" | "id"> | null,
): boolean {
	if (!result?.prefill) return true;
	return !isSameFor(result.prefill, chosen);
}

/** Finds an option by key among the result's options. */
export function findOption(
	result: Pick<LoggingForResult, "options"> | null,
	key: string,
): LoggingOption | null {
	if (!result || !key) return null;
	return result.options.find((o) => forOptionKey(o) === key) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOption(value: unknown): value is LoggingOption {
	return (
		isRecord(value) &&
		typeof value.kind === "string" &&
		typeof value.label === "string"
	);
}

/**
 * A picker result from a 409 `LOGGING_FOR_REQUIRED {options, prefill}` or a
 * 422 `LOGGING_FOR_INVALID {options}` body (server data: read defensively).
 * The unavailable list is not in the error body, so the last known one is
 * kept. Null when the body carries no options.
 */
export function resultFromErrorExtras(
	extras: Record<string, unknown> | null | undefined,
	previous?: LoggingForResult | null,
): LoggingForResult | null {
	const raw = extras?.options;
	if (!Array.isArray(raw)) return null;
	const options = raw.filter(isOption);
	const rawPrefill = isOption(extras?.prefill) ? extras.prefill : null;
	// A prefill must be one of the options (stale defaults are ignored, E26).
	const prefill =
		rawPrefill && options.length > 1
			? (options.find((o) => isSameFor(o, rawPrefill)) ?? null)
			: null;
	const result: LoggingForResult = {
		options,
		selected: null,
		prefill,
		unavailable: previous?.unavailable ?? [],
	};
	if (options.length === 1) result.selected = options[0];
	else if (options.length > 1) result.reason = prefill ? "confirm" : "required";
	else result.reason = "none";
	return result;
}

/** A chip option for an entry's recorded For (its context snapshot). */
export function forChipOptionFromEntry(
	entry: Pick<
		TimeEntryView,
		"context_kind" | "context_ref" | "context_label_snapshot"
	>,
	personalLabel = "Just me",
): ForChipOption {
	const label =
		entry.context_kind === "personal"
			? personalLabel
			: entry.context_label_snapshot?.trim() || personalLabel;
	return {
		kind: entry.context_kind,
		id: entry.context_kind === "personal" ? null : entry.context_ref,
		label,
	};
}

/** `{ text, full, truncated }`: the label cut to `max` characters plus "…". */
export function truncateLabel(
	label: string | null | undefined,
	max: number = CHIP_LABEL_MAX,
): { text: string; full: string; truncated: boolean } {
	const full = (label ?? "").trim();
	if (full.length <= max) return { text: full, full, truncated: false };
	return {
		text: `${full.slice(0, max).trimEnd()}…`,
		full,
		truncated: true,
	};
}

/** The chip's icon family (Users, Building, Briefcase, User). */
export type ForIconKind = "team" | "workspace" | "agreement" | "personal";

export function forIconKind(kind: ContextKind): ForIconKind {
	if (kind === "assignment") return "agreement";
	return kind;
}

/**
 * The engagement whose terms govern an agreement option (A8), for "View
 * terms →" on the web. Null when the backend has not sent it.
 */
export function governingEngagementId(
	option: Pick<ForChipOption, "kind" | "engagement_id"> | null | undefined,
	policy?: { engagement_id?: string | null } | null,
): string | null {
	if (!option || option.kind !== "assignment") return null;
	return option.engagement_id ?? policy?.engagement_id ?? null;
}
