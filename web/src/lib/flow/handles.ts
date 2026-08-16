import type {
	FlowNode,
	HandlePosition,
	HandleRegistration,
	HandleType,
	Point,
} from "./types";

/**
 * Handle geometry and resolution.
 *
 * Geometry is computed from a node's box and the side the handle sits on, never
 * from per-handle DOM measurement.
 *
 * WHICH box matters, and it is not the declared one. A consumer's layout pass
 * may declare a height that is only spacing metadata — the roadmap's epic nodes
 * declare 220 while the card inside renders 137 — and React Flow anchored edges
 * to the CARD, because its handle CSS resolves against the card's own
 * positioning context. Anchoring to the declared box instead leaves a visible
 * gap between an edge and the card it should touch.
 *
 * So callers pass the rendered content size when they have it (one measurement
 * per node, on resize — not per handle and not per frame), and the declared box
 * is the fallback for the first paint and for jsdom.
 */

export function handlePoint(
	node: FlowNode,
	position: HandlePosition,
	contentSize?: { width: number; height: number },
): Point {
	const { x, y } = node.position;
	const width = contentSize?.width ?? node.width ?? 0;
	const height = contentSize?.height ?? node.height ?? 0;

	switch (position) {
		case "left":
			return { x, y: y + height / 2 };
		case "right":
			return { x: x + width, y: y + height / 2 };
		case "top":
			return { x: x + width / 2, y };
		case "bottom":
			return { x: x + width / 2, y: y + height };
	}
}

/**
 * Per-node handle registrations.
 *
 * Handles register themselves during layout, so the registry is populated by
 * children after the canvas commits. It is intentionally a plain mutable store
 * read at draw time rather than React state — see `Flow.tsx` for how a version
 * counter turns registrations into exactly one extra commit.
 */
export class HandleRegistry {
	private byNode = new Map<string, HandleRegistration[]>();

	register(nodeId: string, registration: HandleRegistration): void {
		const list = this.byNode.get(nodeId);
		if (list) {
			list.push(registration);
			// Keep sorted by registration order so `resolve`'s fallback is
			// independent of insertion timing.
			list.sort((a, b) => a.order - b.order);
		} else {
			this.byNode.set(nodeId, [registration]);
		}
	}

	unregister(nodeId: string, registration: HandleRegistration): void {
		const list = this.byNode.get(nodeId);
		if (!list) return;
		const index = list.indexOf(registration);
		if (index !== -1) list.splice(index, 1);
		if (list.length === 0) this.byNode.delete(nodeId);
	}

	get(nodeId: string): HandleRegistration[] {
		return this.byNode.get(nodeId) ?? [];
	}

	/**
	 * Which side of `nodeId` an edge endpoint attaches to.
	 *
	 * When `handleId` is given it wins. When it is null/undefined — which the
	 * roadmap's feature edges rely on, since they name only a `sourceHandle` —
	 * this falls back to the FIRST REGISTERED handle of the matching type,
	 * reproducing React Flow's behaviour. For a feature node that is the Left
	 * target handle.
	 *
	 * Returns null when nothing matches, which callers must treat as "skip this
	 * edge for now" rather than defaulting to a position: a stray edge drawn to
	 * the node origin is far more visible than a missing one.
	 */
	resolve(
		nodeId: string,
		handleId: string | null | undefined,
		type: HandleType,
	): HandleRegistration | null {
		const list = this.byNode.get(nodeId);
		if (!list || list.length === 0) return null;

		if (handleId != null) {
			return list.find((h) => h.id === handleId && h.type === type) ?? null;
		}
		return list.find((h) => h.type === type) ?? null;
	}
}
