// web/src/components/time/page/WaitingSection.tsx
//
// "Waiting for you" on the Time page (ux.md › Approvals): the sheets waiting
// on the viewer, with checkboxes and Approve selected (W1-4's list). The
// wrapper carries `id="waiting"`, the target of `/time#waiting` (sidebar
// badge, dashboard card, the `timesheets_imported` digest).
//
// Normal mode shows it only while something waits (N > 0) and renders
// nothing once the list empties. Approver mode always shows it, with the
// caught-up line when nothing waits.
//
// On phones the rows are full width and link to the review screen; the
// floating bulk bar is off there (the FAB owns the corner), and Approve
// selected stays in the list's header.

import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { WaitingForYouList } from "../approvals/WaitingForYouList";

/** The anchor `/time#waiting` scrolls to. */
export const WAITING_SECTION_ID = "waiting";

export interface WaitingSectionProps {
	/** The overview's `approvals_waiting`. */
	count: number;
	/** Approver mode: always rendered, with `emptyText` when nothing waits. */
	approverMode?: boolean;
	/** The caught-up sentence (approver mode). */
	emptyText?: string;
	/** E27: rows of another policy workspace get a tag. */
	currentWorkspaceId?: string | null;
	/** The floating "N selected" bar (off on phones). */
	floatingBar?: boolean;
	now?: Date;
	userTimezone?: string;
	className?: string;
}

export const WaitingSection = forwardRef<HTMLDivElement, WaitingSectionProps>(
	function WaitingSection(
		{
			count,
			approverMode = false,
			emptyText,
			currentWorkspaceId,
			floatingBar = true,
			now,
			userTimezone,
			className,
		},
		ref,
	) {
		if (!approverMode && count <= 0) return null;
		return (
			<div
				ref={ref}
				id={WAITING_SECTION_ID}
				tabIndex={-1}
				className={cn("scroll-mt-24 focus:outline-none", className)}
			>
				<WaitingForYouList
					currentWorkspaceId={currentWorkspaceId}
					emptyText={approverMode ? (emptyText ?? undefined) : null}
					floatingBar={floatingBar}
					now={now}
					userTimezone={userTimezone}
				/>
			</div>
		);
	},
);
