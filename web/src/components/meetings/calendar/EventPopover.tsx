/**
 * The event details card, Google Calendar style: opens beside the event that
 * was clicked (a bottom sheet on small screens) with the event's color, title
 * and time, a join button, and the actions that apply.
 * - Proyekto meetings: Join, RSVP for invitees, Edit / Cancel for the organizer
 *   (recurring meetings ask which occurrences).
 * - Google Calendar events: Join and "Open in Google Calendar"; Proyekto never
 *   edits them.
 */
import { format } from "date-fns";
import {
	CalendarDays,
	ExternalLink,
	Loader2,
	MapPin,
	Pencil,
	Repeat,
	Trash2,
	Users,
	Video,
	X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { detectProvider } from "@/components/meetings/editor/providers";
import { ScopeDialog } from "@/components/meetings/editor/ScopeDialog";
import { useCancelMeeting, useRespondMeeting } from "@/hooks/useMeetings";
import { MEETING_TYPE_LABELS, type Meeting } from "@/services/meetings.service";
import { CALENDAR_STYLES } from "./calendarStyles";
import { addLocalDays, type CalendarItem, timeRange } from "./items";

const CARD_WIDTH = 380;
const GAP = 8;

function whenLabel(item: CalendarItem): string {
	const { start, end } = item;
	if (item.allDay) {
		const lastDay = addLocalDays(end, -1);
		return lastDay > start
			? `${format(start, "EEE, MMMM d")} – ${format(lastDay, "EEE, MMMM d")}`
			: format(start, "EEEE, MMMM d");
	}
	if (start.toDateString() === end.toDateString()) {
		return `${format(start, "EEEE, MMMM d")} · ${timeRange(start, end)}`;
	}
	return `${format(start, "MMM d, p")} – ${format(end, "MMM d, p")}`;
}

function joinLabel(url: string): string {
	return detectProvider(url) === "google_meet"
		? "Join with Google Meet"
		: "Join video call";
}

interface EventPopoverProps {
	item: CalendarItem | null;
	anchor: DOMRect | null;
	currentUserId?: string;
	onClose: () => void;
	onEditMeeting?: (meeting: Meeting) => void;
}

export function EventPopover({
	item,
	anchor,
	currentUserId,
	onClose,
	onEditMeeting,
}: EventPopoverProps) {
	const cardRef = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

	// Beside the event: to the right when it fits, else to the left; clamped
	// to the viewport once the card's real height is known.
	useLayoutEffect(() => {
		if (!item || !anchor || !cardRef.current) return;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const height = cardRef.current.offsetHeight;
		let left = anchor.right + GAP;
		if (left + CARD_WIDTH > vw - GAP) left = anchor.left - GAP - CARD_WIDTH;
		left = Math.max(GAP, Math.min(left, vw - CARD_WIDTH - GAP));
		const top = Math.max(GAP, Math.min(anchor.top, vh - height - GAP));
		setPos({ left, top });
	}, [item, anchor]);

	useEffect(() => {
		if (!item) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [item, onClose]);

	if (!item) return null;
	const style = CALENDAR_STYLES[item.source];

	return (
		<div className="fixed inset-0 z-50">
			<button
				type="button"
				aria-label="Close"
				onClick={onClose}
				className="absolute inset-0 cursor-default bg-black/20 sm:bg-transparent"
			/>
			<div
				ref={cardRef}
				role="dialog"
				aria-modal="true"
				aria-label={item.title}
				style={
					pos
						? { left: pos.left, top: pos.top, width: CARD_WIDTH }
						: { left: -9999, top: 0, width: CARD_WIDTH }
				}
				className="absolute max-sm:!inset-x-3 max-sm:!bottom-3 max-sm:!top-auto max-sm:!left-3 max-sm:!w-auto rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
			>
				{item.meeting ? (
					<MeetingDetails
						item={item}
						meeting={item.meeting}
						currentUserId={currentUserId}
						swatch={style.dot}
						onClose={onClose}
						onEdit={onEditMeeting}
					/>
				) : (
					<GoogleDetails item={item} swatch={style.dot} onClose={onClose} />
				)}
			</div>
		</div>
	);
}

function Header({
	item,
	swatch,
	actions,
	onClose,
}: {
	item: CalendarItem;
	swatch: string;
	actions?: React.ReactNode;
	onClose: () => void;
}) {
	return (
		<>
			<div className="-mr-1 -mt-1 flex justify-end gap-0.5">
				{actions}
				<IconButton label="Close" onClick={onClose}>
					<X className="h-4 w-4" />
				</IconButton>
			</div>
			<div className="flex items-start gap-3">
				<span className={`mt-1.5 h-3.5 w-3.5 shrink-0 rounded ${swatch}`} />
				<div className="min-w-0">
					<h3 className="break-words text-lg font-semibold leading-snug">
						{item.title}
					</h3>
					<p className="mt-0.5 text-sm text-muted-foreground">
						{whenLabel(item)}
					</p>
				</div>
			</div>
		</>
	);
}

function IconButton({
	label,
	onClick,
	disabled,
	children,
}: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={onClick}
			disabled={disabled}
			className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
		>
			{children}
		</button>
	);
}

function Row({
	icon,
	children,
}: {
	icon: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div className="flex items-start gap-3 text-sm">
			<span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
			<div className="min-w-0 flex-1">{children}</div>
		</div>
	);
}

function JoinButton({ url }: { url: string }) {
	return (
		<a
			href={url}
			target="_blank"
			rel="noopener noreferrer"
			className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
		>
			<Video className="h-4 w-4" />
			{joinLabel(url)}
		</a>
	);
}

function MeetingDetails({
	item,
	meeting,
	currentUserId,
	swatch,
	onClose,
	onEdit,
}: {
	item: CalendarItem;
	meeting: Meeting;
	currentUserId?: string;
	swatch: string;
	onClose: () => void;
	onEdit?: (meeting: Meeting) => void;
}) {
	const cancelMutation = useCancelMeeting();
	const respondMutation = useRespondMeeting();
	const [scopeOpen, setScopeOpen] = useState(false);

	const canManage =
		!!currentUserId &&
		(meeting.created_by === currentUserId || meeting.host_id === currentUserId);
	const mine = meeting.participants?.find((p) => p.user_id === currentUserId);
	const canRespond = !!mine && mine.role !== "host" && !canManage;
	const isRecurring = !!meeting.series_id;
	const guests = (meeting.participants ?? []).filter((p) => p.role !== "host");

	const cancel = () => {
		if (isRecurring) setScopeOpen(true);
		else cancelMutation.mutate(meeting.id, { onSuccess: onClose });
	};

	return (
		<>
			<Header
				item={item}
				swatch={swatch}
				onClose={onClose}
				actions={
					canManage ? (
						<>
							{onEdit && (
								<IconButton
									label="Edit meeting"
									onClick={() => {
										onClose();
										onEdit(meeting);
									}}
								>
									<Pencil className="h-4 w-4" />
								</IconButton>
							)}
							<IconButton
								label="Cancel meeting"
								onClick={cancel}
								disabled={cancelMutation.isPending}
							>
								{cancelMutation.isPending ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<Trash2 className="h-4 w-4" />
								)}
							</IconButton>
						</>
					) : null
				}
			/>

			<div className="mt-4 space-y-3">
				{meeting.meeting_url && (
					<Row icon={<Video className="h-4 w-4" />}>
						<JoinButton url={meeting.meeting_url} />
					</Row>
				)}
				{isRecurring && (
					<Row icon={<Repeat className="h-4 w-4" />}>Repeats</Row>
				)}
				{meeting.location && (
					<Row icon={<MapPin className="h-4 w-4" />}>
						<span className="break-words">{meeting.location}</span>
					</Row>
				)}
				<Row icon={<CalendarDays className="h-4 w-4" />}>
					{MEETING_TYPE_LABELS[meeting.type]}
				</Row>
				{guests.length > 0 && (
					<Row icon={<Users className="h-4 w-4" />}>
						{guests.length} {guests.length === 1 ? "guest" : "guests"}
					</Row>
				)}
				{meeting.description && (
					<p className="whitespace-pre-wrap break-words pl-7 text-sm text-muted-foreground">
						{meeting.description}
					</p>
				)}
			</div>

			{canRespond && (
				<div className="mt-4 flex items-center gap-2 border-t border-border pt-3 text-sm">
					<span className="mr-auto text-muted-foreground">Going?</span>
					{(
						[
							["accepted", "Yes"],
							["declined", "No"],
							["tentative", "Maybe"],
						] as const
					).map(([response, label]) => (
						<button
							key={response}
							type="button"
							disabled={respondMutation.isPending}
							onClick={() =>
								respondMutation.mutate({ id: meeting.id, response })
							}
							className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
								mine?.response === response
									? "border-primary bg-primary/10 text-primary"
									: "border-border text-foreground hover:bg-muted"
							}`}
						>
							{label}
						</button>
					))}
				</div>
			)}

			<ScopeDialog
				open={scopeOpen}
				action="cancel"
				onClose={() => setScopeOpen(false)}
				onPick={(scope) => {
					setScopeOpen(false);
					cancelMutation.mutate(
						{ id: meeting.id, scope },
						{ onSuccess: onClose },
					);
				}}
			/>
		</>
	);
}

function GoogleDetails({
	item,
	swatch,
	onClose,
}: {
	item: CalendarItem;
	swatch: string;
	onClose: () => void;
}) {
	const event = item.googleEvent;
	return (
		<>
			<Header
				item={item}
				swatch={swatch}
				onClose={onClose}
				actions={
					event?.htmlLink ? (
						<a
							href={event.htmlLink}
							target="_blank"
							rel="noopener noreferrer"
							aria-label="Open in Google Calendar"
							title="Open in Google Calendar"
							className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							<ExternalLink className="h-4 w-4" />
						</a>
					) : null
				}
			/>
			<div className="mt-4 space-y-3">
				{event?.meetUrl && (
					<Row icon={<Video className="h-4 w-4" />}>
						<JoinButton url={event.meetUrl} />
					</Row>
				)}
				{event?.location && (
					<Row icon={<MapPin className="h-4 w-4" />}>
						<span className="break-words">{event.location}</span>
					</Row>
				)}
				<Row icon={<CalendarDays className="h-4 w-4" />}>
					<span className="text-muted-foreground">
						Google Calendar · edit it in Google Calendar
					</span>
				</Row>
			</div>
		</>
	);
}
