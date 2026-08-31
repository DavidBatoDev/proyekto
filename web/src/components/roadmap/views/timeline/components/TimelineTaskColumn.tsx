import { ChevronDown, ChevronRight, GripVertical, Plus } from "lucide-react";
import { EpicGlyph, FeatureGlyph } from "@/components/roadmap/shared/NodeGlyph";
import {
	ROW_H,
	rowDisplayKey,
	TASK_COL_WIDTH,
	type TimelineRow,
} from "../model/rows";

interface TimelineTaskColumnProps {
	rows: TimelineRow[];
	rowStart: number;
	rowEnd: number;
	totalHeight: number;
	selectedIds: ReadonlySet<string>;
	canReorder: boolean;
	reorderRowKey: string | null;
	dropIndex: number | null;
	/** Frozen task-column width. Narrowed on mobile; defaults to the desktop 320. */
	taskColWidth?: number;
	/**
	 * Hide the checkbox and the row key. Both are desktop-only affordances that
	 * would crowd out the title in a narrow mobile column.
	 */
	compact?: boolean;
	onToggleSelect: (row: TimelineRow) => void;
	onToggleExpand: (epicId: string) => void;
	onOpenRow: (row: TimelineRow) => void;
	onAddFeature?: (epicId: string) => void;
	onReorderPointerDown: (event: React.PointerEvent, row: TimelineRow) => void;
}

/**
 * Sticky-left task tree. Mirrors the timeline grid row-for-row: same order,
 * same uniform height, same virtual window.
 */
export const TimelineTaskColumn = ({
	rows,
	rowStart,
	rowEnd,
	totalHeight,
	selectedIds,
	canReorder,
	reorderRowKey,
	dropIndex,
	taskColWidth = TASK_COL_WIDTH,
	compact = false,
	onToggleSelect,
	onToggleExpand,
	onOpenRow,
	onAddFeature,
	onReorderPointerDown,
}: TimelineTaskColumnProps) => {
	return (
		<div
			className="sticky left-0 z-20 shrink-0 bg-white border-r border-gray-200"
			style={{ width: taskColWidth, height: totalHeight }}
		>
			{dropIndex !== null && (
				<div
					className="absolute left-0 right-0 z-30 h-0.5 bg-blue-500 pointer-events-none"
					style={{ top: dropIndex * ROW_H }}
				/>
			)}

			{rows.slice(rowStart, rowEnd).map((row, index) => {
				const rowIndex = rowStart + index;
				const isSelected = selectedIds.has(row.rowKey);
				const isReordering = reorderRowKey === row.rowKey;
				const title = row.kind === "epic" ? row.epic.title : row.feature.title;

				return (
					<div
						key={row.rowKey}
						className={`group absolute left-0 flex items-center gap-2 border-b border-gray-100 ${
							compact ? "pr-1.5" : "pr-3"
						} ${isReordering ? "opacity-40" : ""} ${
							isSelected ? "bg-blue-50/60" : "hover:bg-gray-50"
						}`}
						style={{
							top: rowIndex * ROW_H,
							height: ROW_H,
							width: taskColWidth,
							paddingLeft: compact ? 6 + row.depth * 10 : 8 + row.depth * 20,
						}}
					>
						{canReorder ? (
							<button
								type="button"
								data-no-pan="true"
								onPointerDown={(event) => onReorderPointerDown(event, row)}
								className="shrink-0 text-gray-300 opacity-0 group-hover:opacity-100 cursor-grab"
								title="Drag to reorder"
							>
								<GripVertical className="h-3.5 w-3.5" />
							</button>
						) : (
							!compact && <span className="w-3.5 shrink-0" />
						)}

						{!compact && (
							<input
								type="checkbox"
								data-no-pan="true"
								checked={isSelected}
								onChange={() => onToggleSelect(row)}
								className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 accent-blue-600"
								aria-label={`Select ${title}`}
							/>
						)}

						{row.kind === "epic" && row.hasChildren ? (
							<button
								type="button"
								data-no-pan="true"
								onClick={() => onToggleExpand(row.epic.id)}
								// Compact widens the hit area to the full row height so the
								// chevron clears the 44px touch-target floor without changing
								// the glyph size or the row rhythm.
								className={`shrink-0 text-gray-400 hover:text-gray-600 ${
									compact ? "-my-2 flex items-center px-1 py-2" : ""
								}`}
								aria-label={row.isExpanded ? "Collapse" : "Expand"}
							>
								{row.isExpanded ? (
									<ChevronDown className="h-3.5 w-3.5" />
								) : (
									<ChevronRight className="h-3.5 w-3.5" />
								)}
							</button>
						) : (
							<span className={compact ? "w-1 shrink-0" : "w-3.5 shrink-0"} />
						)}

						{row.kind === "epic" ? <EpicGlyph /> : <FeatureGlyph />}

						{!compact && (
							<span className="shrink-0 text-[11px] font-medium text-gray-400 tabular-nums">
								{rowDisplayKey(row)}
							</span>
						)}

						<button
							type="button"
							data-no-pan="true"
							onClick={() => onOpenRow(row)}
							className="min-w-0 flex-1 truncate text-left text-[13px] text-gray-800 hover:underline"
							title={title}
						>
							{title}
						</button>

						{row.kind === "epic" && onAddFeature && (
							<button
								type="button"
								data-no-pan="true"
								onClick={() => onAddFeature(row.epic.id)}
								className="shrink-0 text-gray-300 opacity-0 group-hover:opacity-100 hover:text-blue-600"
								title="Add feature"
							>
								<Plus className="h-3.5 w-3.5" />
							</button>
						)}
					</div>
				);
			})}
		</div>
	);
};
