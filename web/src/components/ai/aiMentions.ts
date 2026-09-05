import { Link } from "@tanstack/react-router";
import { type ComponentType, createElement, type ReactNode } from "react";
import type { RoadmapPreview } from "@/api/endpoints/roadmap";
import type { AgentContextRef } from "@/services/ai-agent.service";
import type { Project } from "@/services/project.service";
import type { Team } from "@/services/teams.service";
import { type AiSessionScope, toRouteProjectId } from "./scope";
import type { AiMentionKind, AiMentionPick, AiMentionSpan } from "./types";

// =============================================================================
// Entity @-mentions for the shared AI kit.
//
// The mechanics are lifted from the project chat composer
// (`project/chat/ChatComposer.tsx` getMentionContext + renderHighlightBackdrop,
// `project/chat/mentions.tsx` resolveMentions + renderMentionContent) and
// generalized from people to entities: projects, roadmaps, epics, features,
// tasks, milestones, and teams. The persisted model (`AiMentionKind`,
// `AiMentionPick`, `AiMentionSpan`) lives in `./types` so the stores never
// depend on this module; it is re-exported here for convenience.
//
// Wire (`refs`) carries only `{kind, id, label}` (D5). `roadmapId`/`projectId`
// stay on the persisted span solely for chip deep links: display-only and
// untrusted.
// =============================================================================

export type { AiMentionKind, AiMentionPick, AiMentionSpan } from "./types";

/** One row the picker can offer. */
export interface AiMentionCandidate {
	kind: AiMentionKind;
	id: string;
	label: string;
	/** Context line under the label (project title, roadmap name, ...). */
	secondary?: string;
	roadmapId?: string;
	projectId?: string | null;
	workspaceId?: string | null;
	/**
	 * Set by `buildAiMentionCandidates` on rows copied from the `primary`
	 * list so the picker can head them "This roadmap" instead of by kind.
	 */
	primary?: boolean;
}

/** The agent rejects more than this many refs per message (`MAX_MESSAGE_REFS`). */
export const MAX_AGENT_REFS = 20;

/**
 * Sentinel span for a ref attached as context only (a chip with no `@Label`
 * in the text). The inline renderers already drop out-of-bounds spans, the
 * wire only carries `{kind,id,label}` and persistence accepts any integer
 * offset, so no other layer has to know about it.
 */
export const CONTEXT_ONLY_SPAN = { offset: -1, length: 0 } as const;

/** True for a span anchored in the text (as opposed to `CONTEXT_ONLY_SPAN`). */
export function isInlineSpan(
	span: Pick<AiMentionSpan, "offset" | "length">,
): boolean {
	return (
		Number.isInteger(span.offset) &&
		Number.isInteger(span.length) &&
		span.offset >= 0 &&
		span.length > 0
	);
}

/** Dedupe key shared by chips, exclusions and the wire. */
export function mentionRefKey(ref: Pick<AiMentionPick, "kind" | "id">): string {
	return `${ref.kind}:${ref.id}`;
}

/** The pick the composer records when a candidate row is chosen. */
export function toMentionPick(candidate: AiMentionCandidate): AiMentionPick {
	return {
		kind: candidate.kind,
		id: candidate.id,
		label: candidate.label,
		...(candidate.roadmapId ? { roadmapId: candidate.roadmapId } : {}),
		...(candidate.projectId !== undefined
			? { projectId: candidate.projectId }
			: {}),
	};
}

/** One chip in the composer's context row. */
export interface AiContextChip extends AiMentionPick {
	/** `mentionRefKey(chip)`; what `onRemoveRef` receives. */
	key: string;
	/** `auto` = attached by the surface (removable per message), `picked` = a draft pick. */
	source: "auto" | "picked";
}

/**
 * The composer's context row: the visible auto refs first, then the draft
 * picks, deduped by `kind:id` (auto wins, so an `@`-mention of the focus
 * roadmap does not double up).
 */
export function buildContextChips(
	autoRefs: readonly AiMentionPick[],
	picks: readonly AiMentionPick[],
): AiContextChip[] {
	const seen = new Set<string>();
	const out: AiContextChip[] = [];
	const push = (ref: AiMentionPick, source: AiContextChip["source"]) => {
		const key = mentionRefKey(ref);
		if (seen.has(key)) return;
		seen.add(key);
		out.push({ ...ref, key, source });
	};
	for (const ref of autoRefs) push(ref, "auto");
	for (const pick of picks) push(pick, "picked");
	return out;
}

/**
 * Everything a message sends: the inline spans (`resolveEntityMentions`)
 * first, then the picks with no `@Label` occurrence and the visible auto refs
 * as context-only spans. Context-only entries are deduped by `kind:id`
 * against the inline spans (inline wins) and each other; the whole list is
 * capped at `MAX_AGENT_REFS` so the context-only tail is what gets trimmed.
 */
export function buildSendRefs(
	content: string,
	picks: readonly AiMentionPick[],
	autoRefs: readonly AiMentionPick[] = [],
): AiMentionSpan[] {
	const out: AiMentionSpan[] = resolveEntityMentions(content, picks);
	const seen = new Set(out.map(mentionRefKey));
	for (const ref of [...picks, ...autoRefs]) {
		const key = mentionRefKey(ref);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ ...ref, ...CONTEXT_ONLY_SPAN });
	}
	return out.slice(0, MAX_AGENT_REFS);
}

/**
 * The refs of a sent message that did NOT render inline (context-only spans,
 * plus any inline span that no longer fits the content), deduped by `kind:id`
 * — what the user bubble lists under "Context".
 */
export function contextRefsForMessage(
	content: string,
	refs: readonly AiMentionSpan[] | undefined,
): AiMentionSpan[] {
	if (!refs || refs.length === 0) return [];
	const inline = new Set(
		inBoundsSpans(refs, content.length).map((span) => mentionRefKey(span)),
	);
	const seen = new Set<string>();
	const out: AiMentionSpan[] = [];
	for (const ref of refs) {
		const key = mentionRefKey(ref);
		if (inline.has(key) || seen.has(key)) continue;
		seen.add(key);
		out.push(ref);
	}
	return out;
}

/** The refs the agent receives: deduped by `kind:id`, first label wins; capped at `MAX_AGENT_REFS`. */
export function toAgentRefs(
	spans: readonly AiMentionSpan[],
): AgentContextRef[] {
	const seen = new Set<string>();
	const out: AgentContextRef[] = [];
	for (const span of spans) {
		const key = `${span.kind}:${span.id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ kind: span.kind, id: span.id, label: span.label });
		if (out.length >= MAX_AGENT_REFS) break;
	}
	return out;
}

// -----------------------------------------------------------------------------
// Trigger detection (verbatim from ChatComposer.tsx:35-55)
// -----------------------------------------------------------------------------

/** Locate an active `@query` token immediately before the caret. */
export function getMentionContext(
	value: string,
	caret: number,
): { start: number; query: string } | null {
	let i = caret - 1;
	while (i >= 0) {
		const ch = value[i];
		if (ch === "@") {
			const prev = i > 0 ? value[i - 1] : " ";
			if (i === 0 || /\s/.test(prev)) {
				const query = value.slice(i + 1, caret);
				if (/\s/.test(query)) return null;
				return { start: i, query };
			}
			return null;
		}
		if (/\s/.test(ch)) return null;
		i -= 1;
	}
	return null;
}

// -----------------------------------------------------------------------------
// Candidates
// -----------------------------------------------------------------------------

export interface BuildAiMentionCandidatesInput {
	query: string;
	/** Focus roadmap + its nodes, built by the roadmap wrapper; rendered first. */
	primary?: readonly AiMentionCandidate[];
	projects?: readonly Project[];
	roadmaps?: readonly RoadmapPreview[];
	teams?: readonly Team[];
	currentWorkspaceId: string | null;
	myWorkspaceIds: readonly string[];
}

/** Fixed group order of the flat candidate array. */
export const AI_MENTION_GROUP_ORDER: readonly AiMentionKind[] = [
	"roadmap",
	"project",
	"epic",
	"feature",
	"task",
	"milestone",
	"team",
];

export const AI_MENTION_GROUP_CAPS: Readonly<
	Record<"primary" | AiMentionKind, number>
> = {
	primary: 6,
	roadmap: 4,
	project: 4,
	epic: 4,
	feature: 4,
	task: 4,
	milestone: 3,
	team: 3,
};

/** Caps for a bare `@` (no query): a short "what can I mention" preview. */
const EMPTY_QUERY_CAPS: Readonly<
	Partial<Record<"primary" | AiMentionKind, number>>
> = {
	primary: 4,
	roadmap: 3,
	project: 3,
};

export const AI_MENTION_TOTAL_CAP = 16;

type WorkspaceLane = "current" | "shared" | "other_workspace";

const LANE_ORDER: Record<WorkspaceLane, number> = {
	current: 0,
	shared: 1,
	other_workspace: 2,
};

/**
 * Which lane an item belongs to, computed by the kit itself rather than via
 * `groupByWorkspace` (which drops other-workspace items the agent can still
 * act on). Unhomed items (null workspace) reached the viewer through project
 * access, so they are `shared`.
 */
export function workspaceLane(
	workspaceId: string | null | undefined,
	currentWorkspaceId: string | null,
	myWorkspaceIds: ReadonlySet<string>,
): WorkspaceLane {
	const id = workspaceId ?? null;
	if (currentWorkspaceId !== null && id === currentWorkspaceId)
		return "current";
	if (id === null || !myWorkspaceIds.has(id)) return "shared";
	return "other_workspace";
}

/**
 * Stable sort into `current -> shared -> other_workspace`. With no current
 * workspace there is nothing to be "current", so the input order is kept.
 */
function orderByWorkspace<T>(
	items: readonly T[],
	workspaceIdOf: (item: T) => string | null | undefined,
	currentWorkspaceId: string | null,
	myWorkspaceIds: ReadonlySet<string>,
): T[] {
	if (currentWorkspaceId === null) return [...items];
	return items
		.map((item, index) => ({
			item,
			index,
			lane: LANE_ORDER[
				workspaceLane(workspaceIdOf(item), currentWorkspaceId, myWorkspaceIds)
			],
		}))
		.sort((a, b) => a.lane - b.lane || a.index - b.index)
		.map((entry) => entry.item);
}

function byPosition<T extends { position?: number | null }>(
	items: readonly T[] | null | undefined,
): T[] {
	return [...(items ?? [])].sort(
		(a, b) => (a.position ?? 0) - (b.position ?? 0),
	);
}

/**
 * The single source of truth for what the picker shows: one flat array in a
 * fixed group order (primary -> roadmaps -> projects -> epics -> features ->
 * tasks -> milestones -> teams) with per-group caps and a total cap, deduped
 * by `kind:id` with `primary` winning. Both the rendered rows and the
 * keyboard's activeIndex index into this array, so the highlighted row and the
 * row Enter commits can never disagree (the `globalSearch.ts` /
 * `mentionCandidates.ts` invariant).
 *
 * Matching is case-insensitive substring, the app-wide convention; a bare `@`
 * returns a short preview (primary/roadmaps/projects only).
 */
export function buildAiMentionCandidates({
	query,
	primary = [],
	projects = [],
	roadmaps = [],
	teams = [],
	currentWorkspaceId,
	myWorkspaceIds,
}: BuildAiMentionCandidatesInput): AiMentionCandidate[] {
	const needle = query.trim().toLowerCase();
	const isEmptyQuery = needle.length === 0;
	const matches = (text: string | null | undefined) =>
		isEmptyQuery || Boolean(text?.toLowerCase().includes(needle));
	const capFor = (group: "primary" | AiMentionKind) =>
		isEmptyQuery
			? (EMPTY_QUERY_CAPS[group] ?? 0)
			: AI_MENTION_GROUP_CAPS[group];

	const mine = new Set(myWorkspaceIds);
	const results: AiMentionCandidate[] = [];
	const seen = new Set<string>();
	const counts: Record<"primary" | AiMentionKind, number> = {
		primary: 0,
		roadmap: 0,
		project: 0,
		epic: 0,
		feature: 0,
		task: 0,
		milestone: 0,
		team: 0,
	};

	const push = (
		group: "primary" | AiMentionKind,
		candidate: AiMentionCandidate,
	): boolean => {
		if (results.length >= AI_MENTION_TOTAL_CAP) return false;
		if (counts[group] >= capFor(group)) return false;
		const key = `${candidate.kind}:${candidate.id}`;
		if (seen.has(key)) return true;
		seen.add(key);
		results.push(candidate);
		counts[group] += 1;
		return true;
	};

	// 1. Primary (focus roadmap + its nodes) — instant, wins the dedupe.
	const focusRoadmapIds = new Set<string>();
	for (const candidate of primary) {
		if (candidate.kind === "roadmap") focusRoadmapIds.add(candidate.id);
		else if (candidate.roadmapId) focusRoadmapIds.add(candidate.roadmapId);
		if (!matches(candidate.label)) continue;
		push("primary", { ...candidate, primary: true });
	}

	// 2. Roadmaps, ordered current -> shared -> other_workspace.
	const orderedRoadmaps = orderByWorkspace(
		roadmaps,
		(r) => r.project?.workspace_id ?? null,
		currentWorkspaceId,
		mine,
	);
	for (const roadmap of orderedRoadmaps) {
		if (!matches(roadmap.name)) continue;
		push("roadmap", {
			kind: "roadmap",
			id: roadmap.id,
			label: roadmap.name,
			secondary: roadmap.project?.title ?? "Standalone roadmap",
			roadmapId: roadmap.id,
			projectId: roadmap.project?.id ?? roadmap.project_id ?? null,
			workspaceId: roadmap.project?.workspace_id ?? null,
		});
	}

	// 3. Projects, same ordering.
	const orderedProjects = orderByWorkspace(
		projects,
		(p) => p.workspace_id ?? null,
		currentWorkspaceId,
		mine,
	);
	for (const project of orderedProjects) {
		if (!matches(project.title)) continue;
		push("project", {
			kind: "project",
			id: project.id,
			label: project.title,
			projectId: project.id,
			workspaceId: project.workspace_id ?? null,
		});
	}

	// 4. Nodes walked from the previews (position-sorted), skipping the focus
	//    roadmap that `primary` already covers.
	if (!isEmptyQuery) {
		const epics: AiMentionCandidate[] = [];
		const features: AiMentionCandidate[] = [];
		const tasks: AiMentionCandidate[] = [];
		const milestones: AiMentionCandidate[] = [];
		for (const roadmap of orderedRoadmaps) {
			if (focusRoadmapIds.has(roadmap.id)) continue;
			const base = {
				roadmapId: roadmap.id,
				projectId: roadmap.project?.id ?? roadmap.project_id ?? null,
				workspaceId: roadmap.project?.workspace_id ?? null,
			};
			for (const epic of byPosition(roadmap.epics)) {
				if (matches(epic.title)) {
					epics.push({
						kind: "epic",
						id: epic.id,
						label: epic.title,
						secondary: roadmap.name,
						...base,
					});
				}
				for (const feature of byPosition(epic.features)) {
					if (matches(feature.title)) {
						features.push({
							kind: "feature",
							id: feature.id,
							label: feature.title,
							secondary: `${roadmap.name} · ${epic.title}`,
							...base,
						});
					}
					for (const task of byPosition(feature.tasks)) {
						if (matches(task.title)) {
							tasks.push({
								kind: "task",
								id: task.id,
								label: task.title,
								secondary: `${roadmap.name} · ${epic.title}`,
								...base,
							});
						}
					}
				}
			}
			for (const milestone of byPosition(roadmap.milestones)) {
				if (matches(milestone.title)) {
					milestones.push({
						kind: "milestone",
						id: milestone.id,
						label: milestone.title,
						secondary: roadmap.name,
						...base,
					});
				}
			}
		}
		for (const candidate of epics) if (!push("epic", candidate)) break;
		for (const candidate of features) if (!push("feature", candidate)) break;
		for (const candidate of tasks) if (!push("task", candidate)) break;
		for (const candidate of milestones)
			if (!push("milestone", candidate)) break;

		// 5. Teams.
		const orderedTeams = orderByWorkspace(
			teams,
			(t) => t.workspace_id ?? null,
			currentWorkspaceId,
			mine,
		);
		for (const team of orderedTeams) {
			if (!matches(team.name)) continue;
			push("team", {
				kind: "team",
				id: team.id,
				label: team.name,
				workspaceId: team.workspace_id ?? null,
			});
		}
	}

	return results;
}

// -----------------------------------------------------------------------------
// Span resolution (mentions.tsx:19-47 generalized)
// -----------------------------------------------------------------------------

/**
 * Resolve composer picks into spans against the final (trimmed) content that
 * will be sent. Each pick claims the first unclaimed `@Label` occurrence;
 * picks whose text was edited away are dropped. Computed once at send (and
 * for the live backdrop) — no offset bookkeeping while typing.
 */
export function resolveEntityMentions(
	content: string,
	picks: readonly AiMentionPick[],
): AiMentionSpan[] {
	const claimed = new Set<number>();
	const out: AiMentionSpan[] = [];

	for (const pick of picks) {
		const token = `@${pick.label}`;
		let from = 0;
		while (from <= content.length) {
			const idx = content.indexOf(token, from);
			if (idx === -1) break;
			if (!claimed.has(idx)) {
				claimed.add(idx);
				out.push({ ...pick, offset: idx, length: token.length });
				break;
			}
			from = idx + 1;
		}
	}

	return out.sort((a, b) => a.offset - b.offset);
}

// -----------------------------------------------------------------------------
// Destinations
// -----------------------------------------------------------------------------

export interface AiEntityDestination {
	to: string;
	params?: Record<string, string>;
	/** Raw entity uuid; the roadmap route's deep-link resolver pans to it. */
	search?: { nodeId: string };
}

/**
 * Where a chip links. Projects open the project roadmap; roadmaps and nodes
 * open the roadmap (nodes deep-link via `nodeId`), the `"n"` sentinel standing
 * in for a missing project; teams link only in workspace scope (the slug is
 * known there). Returns null when the span cannot be linked (a node without
 * a roadmap id, a team in roadmap scope).
 */
export function resolveAiEntityDestination(
	ref: AiMentionPick,
	scope?: AiSessionScope | null,
): AiEntityDestination | null {
	switch (ref.kind) {
		case "project":
			return {
				to: "/project/$projectId/roadmap",
				params: { projectId: ref.id },
			};
		case "roadmap":
			return {
				to: "/project/$projectId/roadmap/$roadmapId",
				params: {
					projectId: toRouteProjectId(ref.projectId),
					roadmapId: ref.id,
				},
			};
		case "epic":
		case "feature":
		case "task":
		case "milestone":
			if (!ref.roadmapId) return null;
			return {
				to: "/project/$projectId/roadmap/$roadmapId",
				params: {
					projectId: toRouteProjectId(ref.projectId),
					roadmapId: ref.roadmapId,
				},
				search: { nodeId: ref.id },
			};
		case "team":
			if (scope?.kind !== "workspace") return null;
			return {
				to: "/w/$workspaceSlug/teams/$teamId",
				params: { workspaceSlug: scope.slug, teamId: ref.id },
			};
		default:
			return null;
	}
}

// -----------------------------------------------------------------------------
// Rendering (mentions.tsx:67-120 generalized; ChatComposer.tsx:71-100 lifted)
// -----------------------------------------------------------------------------

export type AiMentionTone = "onGradient" | "onSurface";

/**
 * Destinations are route strings resolved at runtime (the same loose shape
 * `GlobalSearchBar` hands to `navigate`), so the typed `Link` generics cannot
 * narrow them; render through an untyped alias.
 */
export const AiRouteLink = Link as unknown as ComponentType<
	Record<string, unknown> & { children?: ReactNode }
>;

const CHIP_BASE_CLASS = "rounded px-1 font-medium";
/** Chip colours per surface: on the user bubble's gradient or on a plain surface. */
export const AI_MENTION_CHIP_TONE_CLASS: Record<AiMentionTone, string> = {
	onGradient: "bg-primary-foreground/20 text-primary-foreground",
	onSurface: "bg-primary/10 text-primary",
};
const CHIP_TONE_CLASS = AI_MENTION_CHIP_TONE_CLASS;

function inBoundsSpans<T extends { offset: number; length: number }>(
	spans: readonly T[] | undefined,
	contentLength: number,
): T[] {
	return [...(spans ?? [])]
		.filter(
			(s) =>
				Number.isInteger(s.offset) &&
				Number.isInteger(s.length) &&
				s.offset >= 0 &&
				s.length > 0 &&
				s.offset + s.length <= contentLength,
		)
		.sort((a, b) => a.offset - b.offset);
}

/**
 * Render a user turn with its entity mentions turned into chips. Chips are
 * `<Link>`s when the span resolves to a destination, plain spans otherwise.
 * Falls back to the raw string when there are no (valid) spans so callers can
 * use it unconditionally.
 */
export function renderEntityMentionContent(
	content: string,
	spans: readonly AiMentionSpan[] | undefined,
	opts: { tone: AiMentionTone; scope?: AiSessionScope | null },
): ReactNode {
	const valid = inBoundsSpans(spans, content.length);
	if (valid.length === 0) return content;

	const className = `${CHIP_BASE_CLASS} ${CHIP_TONE_CLASS[opts.tone]}`;
	const nodes: ReactNode[] = [];
	let cursor = 0;
	valid.forEach((span, index) => {
		if (span.offset < cursor) return; // skip overlap
		if (span.offset > cursor) nodes.push(content.slice(cursor, span.offset));
		const text = content.slice(span.offset, span.offset + span.length);
		const key = `mention-${index}-${span.offset}`;
		const destination = resolveAiEntityDestination(span, opts.scope);
		nodes.push(
			destination
				? createElement(
						AiRouteLink,
						{
							key,
							to: destination.to,
							params: destination.params,
							search: destination.search,
							className: `${className} underline-offset-2 hover:underline`,
							"data-mention-kind": span.kind,
						},
						text,
					)
				: createElement(
						"span",
						{ key, className, "data-mention-kind": span.kind },
						text,
					),
		);
		cursor = span.offset + span.length;
	});
	if (cursor < content.length) nodes.push(content.slice(cursor));

	return nodes;
}

/**
 * Render the mirror backdrop: the same text as the textarea but with mention
 * runs wrapped in a pill. All text is transparent (the real textarea text
 * paints on top) — the spans only contribute the highlight background.
 */
export function renderHighlightBackdrop(
	value: string,
	ranges: readonly { offset: number; length: number }[],
): ReactNode[] {
	const spans = inBoundsSpans(ranges, value.length);

	const nodes: ReactNode[] = [];
	let cursor = 0;
	spans.forEach((r, i) => {
		if (r.offset < cursor) return; // skip overlaps
		if (r.offset > cursor) nodes.push(value.slice(cursor, r.offset));
		nodes.push(
			createElement(
				"span",
				{
					key: `hl-${i}-${r.offset}`,
					className: "rounded bg-primary/15 box-decoration-clone",
				},
				value.slice(r.offset, r.offset + r.length),
			),
		);
		cursor = r.offset + r.length;
	});
	// Trailing text (plus a zero-width space so a trailing newline keeps its
	// line height).
	nodes.push(`${value.slice(cursor)}​`);
	return nodes;
}
