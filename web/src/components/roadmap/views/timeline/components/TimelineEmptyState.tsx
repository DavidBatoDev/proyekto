import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface TimelineEmptyStateProps {
	icon: LucideIcon;
	title: string;
	/** One short line explaining what to do next. Optional — the title often says enough. */
	description?: string;
	children?: ReactNode;
}

/**
 * Centred placeholder for the timeline body.
 *
 * Deliberately quiet: a thin outline glyph over muted text, matching the
 * "No teams yet" pattern used elsewhere in the app. An empty timeline is a
 * normal state, not an error, so it should not shout.
 */
export const TimelineEmptyState = ({
	icon: Icon,
	title,
	description,
	children,
}: TimelineEmptyStateProps) => {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-16 text-center">
			<Icon
				className="h-10 w-10 text-gray-300"
				strokeWidth={1.25}
				aria-hidden="true"
			/>
			<div className="space-y-1">
				<p className="text-sm font-medium text-gray-500">{title}</p>
				{description && (
					<p className="max-w-xs text-[13px] text-gray-400">{description}</p>
				)}
			</div>
			{children && (
				<div className="mt-1 flex items-center gap-2">{children}</div>
			)}
		</div>
	);
};
