import type {
	CreateDecisionBody,
	Decision,
	DecisionCategory,
	DecisionOption,
} from "@/services/delivery.service";

/**
 * Optimistic cache updates for decisions.
 *
 * Pure `Decision → Decision` functions with no React and no query client, so the
 * rules are unit-testable on their own — the same split as `deliverableCache.ts`
 * and `changeRequestCache.ts`.
 *
 * Two rules here mirror the server and must stay in step with it:
 *
 * - **One selected option.** `withOptionSelected` clears the sibling, exactly as
 *   `decisions.service.ts` does before its write, because the partial unique
 *   index `uq_decision_options_selected` rejects a second selected row. Patching
 *   two selected options would show a state the database will never hold.
 * - **Superseded is frozen.** The server refuses every edit to a superseded
 *   decision, so nothing here should patch one; the guards below say so out loud
 *   rather than letting a row flicker and snap back.
 */

/** Matches the `temp-` convention used across the app's optimistic paths. */
const TEMP_PREFIX = "temp-";

export function isOptimisticId(id: string): boolean {
	return id.startsWith(TEMP_PREFIX);
}

function tempId(kind: string): string {
	return `${TEMP_PREFIX}${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** History cannot be edited. Mirrors the backend's `assertEditable`. */
export function isEditable(decision: Decision): boolean {
	return decision.status !== "superseded";
}

// ─── List membership ────────────────────────────────────────────────────────

/** Replace by id, or prepend when it's new — the list is newest-first. */
export function upsertDecision(
	list: Decision[],
	decision: Decision,
): Decision[] {
	const index = list.findIndex((d) => d.id === decision.id);
	if (index === -1) return [decision, ...list];
	return list.map((d) => (d.id === decision.id ? decision : d));
}

/**
 * Swap a server row in by the id it replaces, so a `temp-` row becomes the real
 * one rather than being appended alongside it as a duplicate.
 */
export function replaceDecision(
	list: Decision[],
	previousId: string,
	decision: Decision,
): Decision[] {
	const index = list.findIndex((d) => d.id === previousId);
	if (index === -1) return upsertDecision(list, decision);
	return list.map((d) => (d.id === previousId ? decision : d));
}

export function removeDecision(list: Decision[], id: string): Decision[] {
	return list.filter((d) => d.id !== id);
}

// ─── Field patches ──────────────────────────────────────────────────────────

export function withCategory(
	decision: Decision,
	category: DecisionCategory | null,
): Decision {
	return {
		...decision,
		category_id: category?.id ?? null,
		category,
	};
}

/**
 * proposed → final.
 *
 * The server stamps the caller as decider only when the proposal had none, so
 * this does the same; overwriting an existing decider would rewrite attribution
 * the History panel then shows.
 */
export function withFinalized(
	decision: Decision,
	userId: string | undefined,
	today: string,
): Decision {
	if (decision.status !== "proposed") return decision;
	return {
		...decision,
		status: "final",
		decided_by: decision.decided_by ?? userId ?? null,
		decided_on: decision.decided_on || today,
	};
}

/** The row being replaced is retired in the same write, server-side. */
export function withSuperseded(decision: Decision): Decision {
	return { ...decision, status: "superseded" };
}

// ─── Options ────────────────────────────────────────────────────────────────

export function withOptionAdded(
	decision: Decision,
	input: { title: string; detail?: string; is_selected?: boolean },
): Decision {
	const options = decision.options ?? [];
	const option: DecisionOption = {
		id: tempId("option"),
		decision_id: decision.id,
		title: input.title,
		detail: input.detail ?? null,
		is_selected: input.is_selected ?? false,
		position: options.length,
	};
	// Adding a pre-selected option displaces whichever was selected before.
	const previous = option.is_selected
		? options.map((o) => ({ ...o, is_selected: false }))
		: options;
	return { ...decision, options: [...previous, option] };
}

export function withOptionRemoved(
	decision: Decision,
	optionId: string,
): Decision {
	return {
		...decision,
		options: (decision.options ?? []).filter((o) => o.id !== optionId),
	};
}

/**
 * Exactly one option carries the mark. Selecting one necessarily clears the
 * other — the database index will not hold both, so neither does the cache.
 */
export function withOptionSelected(
	decision: Decision,
	optionId: string,
): Decision {
	return {
		...decision,
		options: (decision.options ?? []).map((option) => ({
			...option,
			is_selected: option.id === optionId,
		})),
	};
}

export function withOptionEdited(
	decision: Decision,
	optionId: string,
	patch: { title?: string; detail?: string | null },
): Decision {
	return {
		...decision,
		options: (decision.options ?? []).map((option) =>
			option.id === optionId ? { ...option, ...patch } : option,
		),
	};
}

// ─── Links ──────────────────────────────────────────────────────────────────

/**
 * Link removal patches cleanly because nothing is derived from links.
 *
 * Link ADD is deliberately not here: the trail a new link renders needs the
 * epic/feature titles embedded upward, which only the server read supplies. The
 * caller waits for the response rather than showing a row with no label.
 */
export function withLinkRemoved(decision: Decision, linkId: string): Decision {
	return {
		...decision,
		links: (decision.links ?? []).filter((link) => link.id !== linkId),
	};
}

// ─── Create ─────────────────────────────────────────────────────────────────

/**
 * The placeholder row shown while the create request is in flight.
 *
 * `reference` is null because only the server can allocate it, and the card
 * renders that as "DEC-—". The row is non-interactive until the real one lands:
 * the detail route would 404 on a `temp-` id.
 */
export function optimisticDecision(
	projectId: string,
	body: CreateDecisionBody,
	options: {
		userId?: string;
		today: string;
		category?: DecisionCategory | null;
	},
): Decision {
	const status = body.status ?? "final";
	const now = new Date().toISOString();
	return {
		id: tempId("decision"),
		project_id: projectId,
		reference: null,
		title: body.title,
		context: body.context ?? null,
		decision: body.decision,
		rationale: body.rationale ?? null,
		alternatives_considered: null,
		category_id: body.category_id ?? null,
		// Matches the server: a proposed decision has not been decided by anyone.
		decided_by: status === "proposed" ? null : (options.userId ?? null),
		decided_on: body.decided_on ?? options.today,
		status,
		supersedes_decision_id: body.supersedes_decision_id ?? null,
		version: 1,
		visibility: body.visibility ?? "shared",
		created_at: now,
		updated_at: now,
		category: options.category ?? null,
		links: [],
		options: (body.options ?? []).map((option, index) => ({
			id: tempId("option"),
			decision_id: "",
			title: option.title,
			detail: option.detail ?? null,
			is_selected: option.is_selected ?? false,
			position: index,
		})),
	};
}
