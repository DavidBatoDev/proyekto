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
 * Geometry is ANALYTIC — computed from the node box and the side the handle sits
 * on — never measured from the DOM. That is exact rather than approximate:
 * React Flow's own stylesheet pins handles to the edge midpoints
 * (`left:50%;bottom:0;translate(-50%,50%)` and friends), so the formulas below
 * produce the same points its measurement does. It also means edges are correct
 * on the very first frame, can never go stale, and work in jsdom.
 *
 * The precondition is that every node carries declared `width`/`height`, which
 * the consumer's layout pass guarantees.
 */

export function handlePoint(node: FlowNode, position: HandlePosition): Point {
	const { x, y } = node.position;
	const width = node.width ?? 0;
	const height = node.height ?? 0;

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
