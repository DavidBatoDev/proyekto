import { PenLine } from "lucide-react";
import { G_LABELS, GRANULARITIES } from "../model/constants";
import type { Granularity } from "../model/types";

interface MilestonesToolbarProps {
	granularity: Granularity;
	onGranularityChange: (granularity: Granularity) => void;
	isDateDrawMode?: boolean;
	onToggleDateDrawMode?: () => void;
}

export const MilestonesToolbar = ({
	granularity,
	onGranularityChange,
	isDateDrawMode = false,
	onToggleDateDrawMode,
}: MilestonesToolbarProps) => {
	return (
		<div
			className="absolute z-50 pointer-events-none"
			style={{ top: 8, right: 16 }}
		>
			<div className="pointer-events-auto inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white/95 p-2 shadow-sm backdrop-blur">
				{GRANULARITIES.map((item) => (
					<button
						type="button"
						key={item}
						onClick={() => onGranularityChange(item)}
						className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
							granularity === item
								? "bg-orange-500 text-white shadow-sm"
								: "text-gray-400 hover:text-gray-600 hover:bg-gray-100 border border-gray-200 bg-white"
						}`}
					>
						{G_LABELS[item]}
					</button>
				))}
				{onToggleDateDrawMode && (
					<>
						<div className="w-px h-4 bg-gray-200 mx-1" />
						<button
							type="button"
							onClick={onToggleDateDrawMode}
							title={isDateDrawMode ? "Exit draw mode" : "Draw date ranges"}
							className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
								isDateDrawMode
									? "bg-orange-500 text-white shadow-sm"
									: "text-gray-400 hover:text-gray-600 hover:bg-gray-100 border border-gray-200 bg-white"
							}`}
						>
							<PenLine className="w-3.5 h-3.5" />
							Draw dates
						</button>
					</>
				)}
			</div>
		</div>
	);
};
