/**
 * Asks which occurrences a series edit/cancel applies to: this event, this and
 * following events, or all events — mirroring Google Calendar's prompt.
 */
import { ModalPortal } from "@/components/common/ModalPortal";
import type { MeetingEditScope } from "@/services/meetings.service";

interface ScopeDialogProps {
	open: boolean;
	action: "edit" | "cancel";
	onClose: () => void;
	onPick: (scope: MeetingEditScope) => void;
}

const OPTIONS: { scope: MeetingEditScope; label: string }[] = [
	{ scope: "this", label: "This event" },
	{ scope: "following", label: "This and following events" },
	{ scope: "all", label: "All events" },
];

export function ScopeDialog({
	open,
	action,
	onClose,
	onPick,
}: ScopeDialogProps) {
	if (!open) return null;
	return (
		<ModalPortal>
			<div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-4">
				<div className="w-full max-w-xs rounded-2xl border border-gray-200 bg-white shadow-xl">
					<div className="px-5 pt-4 pb-2">
						<h3 className="text-base font-semibold text-gray-900">
							{action === "edit"
								? "Edit recurring event"
								: "Delete recurring event"}
						</h3>
					</div>
					<div className="px-3 py-2">
						{OPTIONS.map((o) => (
							<button
								key={o.scope}
								type="button"
								onClick={() => onPick(o.scope)}
								className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
							>
								<span className="h-4 w-4 rounded-full border border-gray-300" />
								{o.label}
							</button>
						))}
					</div>
					<div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
						<button
							type="button"
							onClick={onClose}
							className="rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
						>
							Cancel
						</button>
					</div>
				</div>
			</div>
		</ModalPortal>
	);
}
