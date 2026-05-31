import { useReactFlow } from "@xyflow/react";
import type { RemoteCursor } from "@/hooks/useRoadmapCollaboration";

interface Props {
	remoteCursors: RemoteCursor[];
}

/** Rendered as a child of <ReactFlow> so useReactFlow() is in context. */
export function CollaborationCursorsOverlay({ remoteCursors }: Props) {
	const { getViewport } = useReactFlow();
	const viewport = getViewport();

	if (remoteCursors.length === 0) return null;

	return (
		<div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 10 }}>
			{remoteCursors.map((cursor) => {
				const screenX = cursor.x * viewport.zoom + viewport.x;
				const screenY = cursor.y * viewport.zoom + viewport.y;

				return (
					<div
						key={cursor.userId}
						className="absolute top-0 left-0"
						style={{ transform: `translate(${screenX}px, ${screenY}px)` }}
					>
						{/* SVG cursor arrow */}
						<svg
							width="16"
							height="20"
							viewBox="0 0 16 20"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
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
				);
			})}
		</div>
	);
}
