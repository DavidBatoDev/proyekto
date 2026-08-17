import { memo } from "react";
import type { DependencyEdgeGeometry } from "../model/dependencyGeometry";
import { ROW_H } from "../model/rows";

export const DEP_STROKE = "#94a3b8";
export const DEP_STROKE_CONFLICT = "#f97316";

interface TimelineDependencyLayerProps {
	edges: DependencyEdgeGeometry[];
	totalWidth: number;
	totalHeight: number;
	selectedDependencyId: string | null;
	/** In-flight drag preview: a path plus whether the current drop is legal. */
	draftPath: string | null;
	draftIsValid: boolean;
	draftTargetRowTop: number | null;
	canEdit: boolean;
	onSelectDependency: (dependencyId: string | null) => void;
	onRemoveDependency: (dependencyId: string) => void;
}

interface EdgeProps {
	edge: DependencyEdgeGeometry;
	isSelected: boolean;
	canEdit: boolean;
	onSelect: (dependencyId: string | null) => void;
}

/**
 * One edge. Memoized so hovering or selecting a single arrow re-renders only
 * that arrow — the same reason lib/flow/FlowEdges splits FlowEdgeItem out.
 */
const DependencyEdge = memo(
	({ edge, isSelected, canEdit, onSelect }: EdgeProps) => {
		const stroke = edge.isConflict ? DEP_STROKE_CONFLICT : DEP_STROKE;
		const marker = edge.isConflict
			? "url(#timeline-dep-arrow-conflict)"
			: "url(#timeline-dep-arrow)";

		return (
			<g>
				{/* Invisible interaction band: a 1-2px line is essentially
				    unclickable, so a fat transparent stroke carries the hit area. */}
				<path
					d={edge.path}
					fill="none"
					stroke="transparent"
					strokeWidth={16}
					style={{
						pointerEvents: canEdit ? "stroke" : "none",
						cursor: "pointer",
					}}
					data-no-pan="true"
					onPointerDown={(event) => {
						if (!canEdit) return;
						event.stopPropagation();
						onSelect(isSelected ? null : edge.dependencyId);
					}}
				/>
				<path
					d={edge.path}
					fill="none"
					stroke={stroke}
					strokeWidth={isSelected ? 2.5 : 1.5}
					strokeDasharray={edge.isRollup ? "4 3" : undefined}
					opacity={edge.isRollup ? 0.6 : 1}
					markerEnd={marker}
					style={{ pointerEvents: "none" }}
				/>
			</g>
		);
	},
);
DependencyEdge.displayName = "DependencyEdge";

/**
 * SVG overlay for dependency arrows.
 *
 * Mounted inside TimelineGrid's container so its coordinate system is already
 * the one bars use: x is timeline px from the grid's left edge (no task-column
 * offset), y is `rowIndex * ROW_H`.
 *
 * z-5 puts arrows above the row background and BELOW the bars (z-10), which is
 * the universal Gantt convention — a link should never obscure the work.
 *
 * The root is pointer-events:none so it can never swallow a pan that starts on
 * empty grid; only the per-edge interaction bands opt back in.
 */
export const TimelineDependencyLayer = ({
	edges,
	totalWidth,
	totalHeight,
	selectedDependencyId,
	draftPath,
	draftIsValid,
	draftTargetRowTop,
	canEdit,
	onSelectDependency,
	onRemoveDependency,
}: TimelineDependencyLayerProps) => {
	const selectedEdge = selectedDependencyId
		? edges.find((edge) => edge.dependencyId === selectedDependencyId)
		: undefined;

	return (
		<>
			<svg
				className="absolute left-0 top-0 z-[5]"
				width={totalWidth}
				height={totalHeight}
				style={{ overflow: "visible", pointerEvents: "none" }}
				aria-hidden="true"
			>
				<defs>
					{/*
					  Two static markers rather than one with currentColor: marker
					  contents inherit from the <marker>'s own ancestors, not from the
					  referencing path, and context-stroke has patchy support.
					*/}
					<marker
						id="timeline-dep-arrow"
						viewBox="0 0 8 8"
						refX={7}
						refY={4}
						markerWidth={6}
						markerHeight={6}
						orient="auto-start-reverse"
						markerUnits="userSpaceOnUse"
					>
						<path d="M0,0 L8,4 L0,8 z" fill={DEP_STROKE} />
					</marker>
					<marker
						id="timeline-dep-arrow-conflict"
						viewBox="0 0 8 8"
						refX={7}
						refY={4}
						markerWidth={6}
						markerHeight={6}
						orient="auto-start-reverse"
						markerUnits="userSpaceOnUse"
					>
						<path d="M0,0 L8,4 L0,8 z" fill={DEP_STROKE_CONFLICT} />
					</marker>
				</defs>

				{draftTargetRowTop !== null && (
					<rect
						x={0}
						y={draftTargetRowTop}
						width={totalWidth}
						height={ROW_H}
						fill={draftIsValid ? "#2563eb" : "#ef4444"}
						opacity={0.06}
					/>
				)}

				{edges.map((edge) => (
					<DependencyEdge
						key={edge.dependencyId}
						edge={edge}
						isSelected={edge.dependencyId === selectedDependencyId}
						canEdit={canEdit}
						onSelect={onSelectDependency}
					/>
				))}

				{draftPath && (
					<path
						d={draftPath}
						fill="none"
						stroke={draftIsValid ? "#2563eb" : "#ef4444"}
						strokeWidth={2}
						strokeDasharray="5 4"
						markerEnd={draftIsValid ? "url(#timeline-dep-arrow)" : undefined}
						style={{ pointerEvents: "none" }}
					/>
				)}
			</svg>

			{/* Remove affordance for the selected edge. A DOM button rather than
			    SVG so it inherits normal button styling and focus behaviour.
			    getSimpleBezierPath already hands us the label point. */}
			{selectedEdge && canEdit && (
				<button
					type="button"
					data-no-pan="true"
					onClick={() => onRemoveDependency(selectedEdge.dependencyId)}
					className="absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-red-600 shadow-sm hover:bg-red-50"
					style={{ left: selectedEdge.labelX, top: selectedEdge.labelY }}
				>
					Remove link
				</button>
			)}
		</>
	);
};
