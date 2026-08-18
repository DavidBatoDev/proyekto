import { useRef, useState } from "react";

interface Point {
	x: number;
	y: number;
}

type Stroke = Point[];

interface PresentationHighlighterProps {
	/** While true, captures pointer drags as ink strokes instead of letting
	 * them reach the canvas underneath. */
	active: boolean;
	/** Bump to clear every stroke drawn so far. */
	clearToken: number;
}

/**
 * Freehand annotation layer for presentation mode — a laser-pointer-style
 * highlighter, not a data tool. Strokes live only in this component's local
 * state (reset for free whenever the parent unmounts it, i.e. on exiting
 * presentation mode) and are never sent anywhere.
 */
export function PresentationHighlighter({
	active,
	clearToken,
}: PresentationHighlighterProps) {
	const [strokes, setStrokes] = useState<Stroke[]>([]);
	const [drawingStroke, setDrawingStroke] = useState<Stroke | null>(null);
	const svgRef = useRef<SVGSVGElement | null>(null);
	const lastClearTokenRef = useRef(clearToken);

	if (lastClearTokenRef.current !== clearToken) {
		lastClearTokenRef.current = clearToken;
		if (strokes.length > 0) setStrokes([]);
		if (drawingStroke) setDrawingStroke(null);
	}

	const pointFromEvent = (event: React.PointerEvent<SVGSVGElement>): Point => {
		const rect = svgRef.current?.getBoundingClientRect();
		if (!rect) return { x: event.clientX, y: event.clientY };
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	};

	const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
		if (!active) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		setDrawingStroke([pointFromEvent(event)]);
	};

	const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
		if (!active || !drawingStroke) return;
		setDrawingStroke((prev) =>
			prev ? [...prev, pointFromEvent(event)] : prev,
		);
	};

	const commitStroke = () => {
		if (!drawingStroke) return;
		if (drawingStroke.length > 1) {
			setStrokes((prev) => [...prev, drawingStroke]);
		}
		setDrawingStroke(null);
	};

	const pathFor = (stroke: Stroke) =>
		`M ${stroke.map((point) => `${point.x},${point.y}`).join(" L ")}`;

	return (
		<svg
			ref={svgRef}
			role="presentation"
			// z-40: above everything the canvas itself stacks locally (collaborator
			// presence bar at z-30, per-node drag z-index) so strokes always draw in
			// front of cards, but still below RoadmapModalLayout's modals (z-60) in
			// case one is opened while a stroke is mid-draw.
			className={`absolute inset-0 z-40 h-full w-full ${active ? "cursor-crosshair" : "pointer-events-none"}`}
			style={active ? { touchAction: "none" } : undefined}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={commitStroke}
			onPointerLeave={commitStroke}
		>
			{strokes.map((stroke, index) => (
				<path
					key={index}
					d={pathFor(stroke)}
					fill="none"
					stroke="#f59e0b"
					strokeOpacity={0.55}
					strokeWidth={10}
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			))}
			{drawingStroke && (
				<path
					d={pathFor(drawingStroke)}
					fill="none"
					stroke="#f59e0b"
					strokeOpacity={0.55}
					strokeWidth={10}
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			)}
		</svg>
	);
}
