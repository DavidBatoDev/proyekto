/**
 * Details for a read-only Google Calendar event: when, where, and links back to
 * Google (to edit it there) or into its Meet call. Proyekto never edits these.
 */
import { format } from "date-fns";
import { CalendarDays, ExternalLink, MapPin, Video, X } from "lucide-react";
import { useEffect } from "react";
import type { GoogleCalendarEvent } from "@/services/meetings.service";
import { googleEventBounds } from "./googleEvents";

function whenLabel(event: GoogleCalendarEvent): string {
	const { start, end } = googleEventBounds(event);
	if (event.allDay) {
		const lastDay = new Date(
			end.getFullYear(),
			end.getMonth(),
			end.getDate() - 1,
		);
		return lastDay > start
			? `${format(start, "EEE, MMM d")} – ${format(lastDay, "EEE, MMM d")} · All day`
			: `${format(start, "EEEE, MMM d")} · All day`;
	}
	const sameDay = start.toDateString() === end.toDateString();
	return sameDay
		? `${format(start, "EEEE, MMM d")} · ${format(start, "p")} – ${format(end, "p")}`
		: `${format(start, "EEE, MMM d, p")} – ${format(end, "EEE, MMM d, p")}`;
}

interface GoogleEventDetailsProps {
	event: GoogleCalendarEvent | null;
	onClose: () => void;
}

export function GoogleEventDetails({
	event,
	onClose,
}: GoogleEventDetailsProps) {
	useEffect(() => {
		if (!event) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [event, onClose]);

	if (!event) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
			<button
				type="button"
				aria-label="Close"
				onClick={onClose}
				className="absolute inset-0 bg-black/30"
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={event.title}
				className="relative w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-xl"
			>
				<div className="flex items-start justify-between gap-3">
					<h3 className="text-base font-semibold text-gray-900">
						{event.title}
					</h3>
					<button
						type="button"
						aria-label="Close"
						onClick={onClose}
						className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				<div className="mt-3 space-y-2 text-sm text-gray-600">
					<p className="flex items-start gap-2">
						<CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
						<span>{whenLabel(event)}</span>
					</p>
					{event.location && (
						<p className="flex items-start gap-2">
							<MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
							<span className="break-words">{event.location}</span>
						</p>
					)}
				</div>

				<p className="mt-4 text-xs text-gray-400">
					From your Google Calendar. Edit it in Google Calendar.
				</p>

				<div className="mt-4 flex flex-wrap gap-2">
					{event.meetUrl && (
						<a
							href={event.meetUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90"
						>
							<Video className="h-4 w-4" /> Join Google Meet
						</a>
					)}
					{event.htmlLink && (
						<a
							href={event.htmlLink}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
						>
							<ExternalLink className="h-4 w-4" /> Open in Google Calendar
						</a>
					)}
				</div>
			</div>
		</div>
	);
}
