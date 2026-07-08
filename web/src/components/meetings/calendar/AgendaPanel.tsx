/**
 * The day agenda side panel: the selected day's meetings with Join / RSVP /
 * Cancel actions. The per-row logic is lifted from the original
 * MeetingsCalendar so behavior (who can manage vs. respond) is unchanged.
 */
import { format } from "date-fns";
import { CalendarDays, Loader2, Pencil, Video } from "lucide-react";
import { useCancelMeeting, useRespondMeeting } from "@/hooks/useMeetings";
import { MEETING_TYPE_LABELS, type Meeting } from "@/services/meetings.service";
import { meetingsOnDay } from "./model";

interface AgendaPanelProps {
	selectedDay: Date;
	meetings: Meeting[];
	currentUserId?: string;
	onEdit?: (meeting: Meeting) => void;
}

export function AgendaPanel({
	selectedDay,
	meetings,
	currentUserId,
	onEdit,
}: AgendaPanelProps) {
	const dayMeetings = meetingsOnDay(meetings, selectedDay);

	return (
		<div className="flex h-full min-h-0 flex-col rounded-2xl border border-gray-200 bg-white p-5">
			<div className="mb-3 flex shrink-0 items-center gap-2">
				<CalendarDays className="h-4 w-4 text-gray-400" />
				<h4 className="text-sm font-semibold text-gray-900">
					{format(selectedDay, "EEEE, MMM d")}
				</h4>
			</div>
			{dayMeetings.length === 0 ? (
				<p className="text-sm text-gray-500">No meetings scheduled.</p>
			) : (
				<div className="thin-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto">
					{dayMeetings.map((m) => (
						<MeetingRow
							key={m.id}
							meeting={m}
							currentUserId={currentUserId}
							onEdit={onEdit}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function MeetingRow({
	meeting,
	currentUserId,
	onEdit,
}: {
	meeting: Meeting;
	currentUserId?: string;
	onEdit?: (meeting: Meeting) => void;
}) {
	const cancelMutation = useCancelMeeting();
	const respondMutation = useRespondMeeting();

	const canManage =
		!!currentUserId &&
		(meeting.created_by === currentUserId || meeting.host_id === currentUserId);
	const myParticipation = meeting.participants?.find(
		(p) => p.user_id === currentUserId,
	);
	const canRespond =
		!!myParticipation && myParticipation.role !== "host" && !canManage;

	return (
		<div className="rounded-xl border border-gray-100 p-3">
			<div className="flex items-start justify-between gap-2">
				<div>
					<p className="text-sm font-medium text-gray-900">{meeting.title}</p>
					<p className="text-xs text-gray-500">
						{format(new Date(meeting.scheduled_at), "p")}
						{meeting.ends_at
							? ` – ${format(new Date(meeting.ends_at), "p")}`
							: ""}{" "}
						· {MEETING_TYPE_LABELS[meeting.type]}
					</p>
				</div>
				{meeting.meeting_url && (
					<a
						href={meeting.meeting_url}
						target="_blank"
						rel="noreferrer"
						className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-white hover:bg-primary/90"
					>
						<Video className="h-3.5 w-3.5" /> Join
					</a>
				)}
			</div>

			{(canManage || canRespond) && (
				<div className="mt-2 flex flex-wrap gap-2">
					{canRespond && (
						<>
							<button
								type="button"
								disabled={respondMutation.isPending}
								onClick={() =>
									respondMutation.mutate({
										id: meeting.id,
										response: "accepted",
									})
								}
								className="rounded-lg border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-700 hover:bg-green-100 disabled:opacity-60"
							>
								Accept
							</button>
							<button
								type="button"
								disabled={respondMutation.isPending}
								onClick={() =>
									respondMutation.mutate({
										id: meeting.id,
										response: "declined",
									})
								}
								className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-60"
							>
								Decline
							</button>
						</>
					)}
					{canManage && onEdit && (
						<button
							type="button"
							onClick={() => onEdit(meeting)}
							className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
						>
							<Pencil className="h-3 w-3" /> Edit
						</button>
					)}
					{canManage && (
						<button
							type="button"
							disabled={cancelMutation.isPending}
							onClick={() => cancelMutation.mutate(meeting.id)}
							className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60"
						>
							{cancelMutation.isPending && (
								<Loader2 className="h-3 w-3 animate-spin" />
							)}
							Cancel
						</button>
					)}
					{myParticipation && myParticipation.response !== "pending" && (
						<span className="self-center text-xs text-gray-400">
							You: {myParticipation.response}
						</span>
					)}
				</div>
			)}
		</div>
	);
}
