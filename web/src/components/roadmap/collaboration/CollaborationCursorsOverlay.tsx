import { useReactFlow } from "@xyflow/react";
import { useEffect, useRef } from "react";
import type { RemoteCursor } from "@/hooks/useRoadmapCollaboration";

interface Props {
	remoteCursors: RemoteCursor[];
}

// Per-frame easing toward the latest broadcast sample. ~0.3 reaches the target
// in ~150ms (a touch slower than the ~100ms send cadence), so motion stays
// continuous and smooth rather than snapping between samples.
const EASE = 0.3;
const SNAP_EPSILON = 0.5;

/**
 * Rendered as a child of <ReactFlow> so useReactFlow() is in context.
 *
 * Smoothing: broadcast positions are treated as *targets*; a requestAnimationFrame
 * loop eases each cursor toward its target and writes the transform directly to
 * the DOM (no React re-render per frame). Interpolation happens in canvas
 * coordinates and the live viewport transform is applied every frame, so the
 * cursor glides between samples while staying locked to the canvas during
 * pan/zoom.
 */
export function CollaborationCursorsOverlay({ remoteCursors }: Props) {
	const { getViewport } = useReactFlow();

	// Latest targets, read by the rAF loop without re-subscribing.
	const targetsRef = useRef<RemoteCursor[]>(remoteCursors);
	targetsRef.current = remoteCursors;

	// Interpolated canvas-space position per cursor.
	const renderedRef = useRef<Map<string, { x: number; y: number }>>(new Map());
	// Live cursor DOM nodes, keyed by userId.
	const elsRef = useRef<Map<string, HTMLDivElement>>(new Map());

	useEffect(() => {
		let raf = 0;
		const tick = () => {
			const vp = getViewport();
			const rendered = renderedRef.current;
			const liveIds = new Set<string>();

			for (const cursor of targetsRef.current) {
				liveIds.add(cursor.userId);
				let pos = rendered.get(cursor.userId);
				if (!pos) {
					// First sample for this user — appear at the real spot, no glide-in.
					pos = { x: cursor.x, y: cursor.y };
					rendered.set(cursor.userId, pos);
				} else {
					pos.x += (cursor.x - pos.x) * EASE;
					pos.y += (cursor.y - pos.y) * EASE;
					if (Math.abs(cursor.x - pos.x) < SNAP_EPSILON) pos.x = cursor.x;
					if (Math.abs(cursor.y - pos.y) < SNAP_EPSILON) pos.y = cursor.y;
				}

				const el = elsRef.current.get(cursor.userId);
				if (el) {
					const screenX = pos.x * vp.zoom + vp.x;
					const screenY = pos.y * vp.zoom + vp.y;
					el.style.transform = `translate(${screenX}px, ${screenY}px)`;
				}
			}

			// Drop easing state for cursors that are gone (the rAF loop owns this,
			// since inline ref callbacks churn on every render).
			for (const id of rendered.keys()) {
				if (!liveIds.has(id)) rendered.delete(id);
			}

			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [getViewport]);

	if (remoteCursors.length === 0) return null;

	return (
		<div
			className="absolute inset-0 pointer-events-none overflow-hidden"
			style={{ zIndex: 10 }}
		>
			{remoteCursors.map((cursor) => (
				<div
					key={cursor.userId}
					ref={(el) => {
						if (!el) {
							// Inline ref fires null on every re-render — only drop the DOM
							// handle here; the rAF loop owns easing-state cleanup so the
							// animation survives re-renders.
							elsRef.current.delete(cursor.userId);
							return;
						}
						elsRef.current.set(cursor.userId, el);
						// Only set the initial transform the first time we see this cursor
						// (no existing easing state), so re-renders don't snap it back to
						// the target mid-glide.
						if (!renderedRef.current.has(cursor.userId)) {
							const vp = getViewport();
							el.style.transform = `translate(${
								cursor.x * vp.zoom + vp.x
							}px, ${cursor.y * vp.zoom + vp.y}px)`;
						}
					}}
					className="absolute top-0 left-0"
					style={{ willChange: "transform" }}
				>
					{/* SVG cursor arrow */}
					<svg
						width="16"
						height="20"
						viewBox="0 0 16 20"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
						aria-hidden="true"
						style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))" }}
					>
						<path
							d="M0 0L0 14L4 10L7 17L9 16L6 9L11 9L0 0Z"
							fill={cursor.color}
							stroke="white"
							strokeWidth="1"
							strokeLinejoin="round"
						/>
					</svg>
					{/* Name badge */}
					<div
						className="absolute top-4 left-3 px-1.5 py-0.5 rounded text-white text-[11px] font-medium whitespace-nowrap leading-tight shadow-sm"
						style={{ backgroundColor: cursor.color }}
					>
						{cursor.name}
					</div>
				</div>
			))}
		</div>
	);
}
