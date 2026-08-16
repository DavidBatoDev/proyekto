/* @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FlowNode, Viewport } from "./types";
import { useNodeDrag } from "./useNodeDrag";

/**
 * Gesture tests for node dragging.
 *
 * jsdom has no pointer events and no pointer capture, so both are stubbed
 * below. What is being tested is the arithmetic and the decision logic — the
 * zoom-scaled delta, the movement threshold, the opt-out selectors — all of
 * which are exactly the parts that fail silently in a browser (a node that
 * drifts from the cursor at 40% zoom looks plausible until you measure it).
 */

beforeAll(() => {
	if (!("PointerEvent" in globalThis)) {
		// jsdom ships no PointerEvent; MouseEvent carries every field we read.
		class StubPointerEvent extends MouseEvent {
			pointerId: number;
			constructor(type: string, init: MouseEventInit & { pointerId?: number }) {
				super(type, init);
				this.pointerId = init.pointerId ?? 1;
			}
		}
		(globalThis as unknown as { PointerEvent: unknown }).PointerEvent =
			StubPointerEvent;
	}
	Element.prototype.setPointerCapture = vi.fn();
	Element.prototype.releasePointerCapture = vi.fn();
});

function pointer(
	type: string,
	x: number,
	y: number,
	target: Element,
	button = 0,
) {
	const event = new MouseEvent(type, {
		bubbles: true,
		clientX: x,
		clientY: y,
		button,
	});
	Object.defineProperty(event, "pointerId", { value: 1 });
	target.dispatchEvent(event);
}

const NODE: FlowNode = {
	id: "epic-1",
	type: "epicWidget",
	position: { x: 100, y: 340 },
	data: {},
	width: 500,
	height: 220,
};

interface HarnessProps {
	zoom?: number;
	enabled?: boolean;
	nodes?: FlowNode[];
	inner?: string;
	callbacks: {
		onNodeDragStart?: (event: unknown, node: FlowNode) => void;
		onNodeDrag?: (event: unknown, node: FlowNode) => void;
		onNodeDragStop?: (event: unknown, node: FlowNode) => void;
	};
}

function Harness({
	zoom = 1,
	enabled = true,
	nodes = [NODE],
	inner,
	callbacks,
}: HarnessProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const nodesRef = useRef(nodes);
	nodesRef.current = nodes;
	const viewport: Viewport = { x: 0, y: 0, zoom };

	useNodeDrag({
		containerRef,
		nodesRef,
		getViewport: () => viewport,
		enabled,
		...callbacks,
	});

	return (
		<div ref={containerRef} data-testid="container">
			<div
				className="flow__node"
				data-id="epic-1"
				data-testid="node"
				style={{ transform: "translate(100px, 340px)" }}
			>
				{inner ? (
					<div className={inner} data-testid="inner">
						inner
					</div>
				) : (
					"card"
				)}
			</div>
		</div>
	);
}

// Vitest has no auto-cleanup configured here, and every test mounts its own
// harness into the same document.
afterEach(cleanup);

describe("useNodeDrag", () => {
	it("reports absolute positions that include the drag delta", () => {
		const onNodeDrag = vi.fn();
		const { getByTestId } = render(<Harness callbacks={{ onNodeDrag }} />);
		const node = getByTestId("node");

		pointer("pointerdown", 200, 200, node);
		pointer("pointermove", 260, 230, node);

		expect(onNodeDrag).toHaveBeenCalledTimes(1);
		// Not a delta — the absolute canvas position, which is what the reorder
		// maths consumes directly.
		expect(onNodeDrag.mock.calls[0][1].position).toEqual({ x: 160, y: 370 });
	});

	it("scales the delta by zoom so the node tracks the cursor 1:1", () => {
		// A 100px cursor move must become 100/zoom canvas units — at 40% zoom the
		// node travels 250 canvas units to stay under the pointer. Getting this
		// wrong is invisible at the default zoom and obvious everywhere else.
		for (const [zoom, x, y] of [
			[0.4, 350, 590],
			[1, 200, 440],
			[1.5, 100 + 100 / 1.5, 340 + 100 / 1.5],
		] as const) {
			const onNodeDrag = vi.fn();
			const { getByTestId, unmount } = render(
				<Harness zoom={zoom} callbacks={{ onNodeDrag }} />,
			);
			const node = getByTestId("node");

			pointer("pointerdown", 0, 0, node);
			pointer("pointermove", 100, 100, node);

			const position = onNodeDrag.mock.calls[0][1].position;
			expect(position.x).toBeCloseTo(x, 9);
			expect(position.y).toBeCloseTo(y, 9);
			unmount();
		}
	});

	it("writes the transform directly, without a React render", () => {
		const { getByTestId } = render(<Harness callbacks={{}} />);
		const node = getByTestId("node");

		pointer("pointerdown", 200, 200, node);
		pointer("pointermove", 240, 260, node);

		expect(node.style.transform).toBe("translate(140px, 400px)");
	});

	it("does not start until movement exceeds the threshold", () => {
		const onNodeDragStart = vi.fn();
		const { getByTestId } = render(<Harness callbacks={{ onNodeDragStart }} />);
		const node = getByTestId("node");

		pointer("pointerdown", 200, 200, node);
		pointer("pointermove", 200, 200, node);
		expect(onNodeDragStart).not.toHaveBeenCalled();

		pointer("pointermove", 205, 200, node);
		expect(onNodeDragStart).toHaveBeenCalledTimes(1);
	});

	it("emits nothing when dragging is disabled", () => {
		const onNodeDragStart = vi.fn();
		const onNodeDrag = vi.fn();
		const { getByTestId } = render(
			<Harness enabled={false} callbacks={{ onNodeDragStart, onNodeDrag }} />,
		);
		const node = getByTestId("node");

		pointer("pointerdown", 200, 200, node);
		pointer("pointermove", 260, 260, node);

		expect(onNodeDragStart).not.toHaveBeenCalled();
		expect(onNodeDrag).not.toHaveBeenCalled();
		expect(node.style.transform).toBe("translate(100px, 340px)");
	});

	it("ignores presses inside a .nodrag region", () => {
		const onNodeDrag = vi.fn();
		const { getByTestId } = render(
			<Harness inner="nodrag" callbacks={{ onNodeDrag }} />,
		);

		pointer("pointerdown", 200, 200, getByTestId("inner"));
		pointer("pointermove", 260, 260, getByTestId("inner"));

		expect(onNodeDrag).not.toHaveBeenCalled();
	});

	it("ignores presses on interactive controls inside a node", () => {
		const onNodeDrag = vi.fn();
		function ButtonHarness() {
			const containerRef = useRef<HTMLDivElement | null>(null);
			const nodesRef = useRef([NODE]);
			return (
				<div ref={containerRef}>
					<div className="flow__node" data-id="epic-1">
						<button type="button" data-testid="btn">
							edit
						</button>
					</div>
					<Wire containerRef={containerRef} nodesRef={nodesRef} />
				</div>
			);
		}
		function Wire({
			containerRef,
			nodesRef,
		}: {
			containerRef: React.RefObject<HTMLDivElement | null>;
			nodesRef: React.RefObject<FlowNode[]>;
		}) {
			useNodeDrag({
				containerRef,
				nodesRef,
				getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
				enabled: true,
				onNodeDrag,
			});
			return null;
		}

		const { getByTestId } = render(<ButtonHarness />);
		pointer("pointerdown", 200, 200, getByTestId("btn"));
		pointer("pointermove", 260, 260, getByTestId("btn"));

		expect(onNodeDrag).not.toHaveBeenCalled();
	});

	it("only drags with the primary button", () => {
		const onNodeDrag = vi.fn();
		const { getByTestId } = render(<Harness callbacks={{ onNodeDrag }} />);
		const node = getByTestId("node");

		// Right-drag pans the canvas; it must not move a node.
		pointer("pointerdown", 200, 200, node, 2);
		pointer("pointermove", 260, 260, node);

		expect(onNodeDrag).not.toHaveBeenCalled();
	});

	it("reports the drop position and hands the element back to React", () => {
		const onNodeDragStop = vi.fn();
		const { getByTestId } = render(<Harness callbacks={{ onNodeDragStop }} />);
		const node = getByTestId("node");

		pointer("pointerdown", 200, 200, node);
		pointer("pointermove", 300, 400, node);
		pointer("pointerup", 300, 400, node);

		expect(onNodeDragStop.mock.calls[0][1].position).toEqual({
			x: 200,
			y: 540,
		});
		// The imperative transform must be reverted to the authoritative value on
		// release. React never saw the direct writes, so on a no-op drop — where
		// nothing re-renders — a leftover transform would strand the node.
		expect(node.style.transform).toBe("translate(100px, 340px)");
	});

	it("treats a press with no movement as a click, not a drag", () => {
		const onNodeDragStart = vi.fn();
		const onNodeDragStop = vi.fn();
		const { getByTestId } = render(
			<Harness callbacks={{ onNodeDragStart, onNodeDragStop }} />,
		);
		const node = getByTestId("node");

		pointer("pointerdown", 200, 200, node);
		pointer("pointerup", 200, 200, node);

		expect(onNodeDragStart).not.toHaveBeenCalled();
		expect(onNodeDragStop).not.toHaveBeenCalled();
	});

	it("carries the node's identity and data through to the consumer", () => {
		// The reorder machine reads node.type and data.feature.epic_id on start.
		const feature: FlowNode = {
			id: "feature-1",
			type: "featureWidget",
			position: { x: 750, y: 200 },
			data: { feature: { epic_id: "epic-9" } },
			width: 500,
			height: 150,
		};
		const onNodeDragStart = vi.fn();
		function FeatureHarness() {
			const containerRef = useRef<HTMLDivElement | null>(null);
			const nodesRef = useRef([feature]);
			useNodeDrag({
				containerRef,
				nodesRef,
				getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
				enabled: true,
				onNodeDragStart,
			});
			return (
				<div ref={containerRef}>
					<div className="flow__node" data-id="feature-1" data-testid="fnode">
						card
					</div>
				</div>
			);
		}

		const { getByTestId } = render(<FeatureHarness />);
		pointer("pointerdown", 0, 0, getByTestId("fnode"));
		pointer("pointermove", 40, 40, getByTestId("fnode"));

		const reported = onNodeDragStart.mock.calls[0][1] as FlowNode;
		expect(reported.type).toBe("featureWidget");
		expect(reported.data).toEqual({ feature: { epic_id: "epic-9" } });
	});
});
