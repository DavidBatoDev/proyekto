/**
 * Google-Calendar-style event editor (create + edit). Replaces the basic
 * BookMeetingModal: separate start-date / start-time / end-time, an IANA
 * timezone picker (DST-correct wall-clock → UTC via lib/datetime), a branded
 * video-provider picker, member + external-email guests, location, description,
 * and a reminder. Recurrence lands in a later phase.
 *
 * Reuses the projectId + members contract so it drops into the project team page
 * as well as the standalone /meetings calendar.
 */
import { addMinutes, format } from "date-fns";
import {
	AlignLeft,
	Bell,
	Clock,
	Loader2,
	MapPin,
	Repeat,
	Users,
	Video,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ModalPortal } from "@/components/common/ModalPortal";
import { useBookMeeting, useUpdateMeeting } from "@/hooks/useMeetings";
import {
	diffMinutes,
	localTimeZone,
	utcToZonedParts,
	wallTimeToUtcISO,
} from "@/lib/datetime";
import {
	type CreateMeetingPayload,
	MEETING_TYPE_LABELS,
	type Meeting,
	type MeetingEditScope,
	type MeetingType,
	type UpdateMeetingPayload,
	type VideoOption,
} from "@/services/meetings.service";
import { DatePickerField } from "./DatePickerField";
import { RepeatDropdown } from "./RepeatDropdown";
import { ScopeDialog } from "./ScopeDialog";
import { TimePicker } from "./TimePicker";
import { TimezoneSelect } from "./TimezoneSelect";
import { VideoProviderPicker } from "./VideoProviderPicker";

export interface MeetingMember {
	id: string;
	name: string;
}

interface MeetingEditorModalProps {
	open: boolean;
	onClose: () => void;
	/** Scope the meeting to a project (attendees must be members). */
	projectId?: string;
	/** Project members offered as invitees (excluding the current user). */
	members?: MeetingMember[];
	defaultType?: MeetingType;
	/** Prefill the start when creating from a calendar slot. */
	defaultStart?: Date;
	/** When set, edit this meeting instead of creating a new one. */
	meeting?: Meeting | null;
	onSaved?: (meeting: Meeting) => void;
}

const TYPE_OPTIONS = Object.entries(MEETING_TYPE_LABELS) as [
	MeetingType,
	string,
][];

const REMINDER_OPTIONS: { label: string; value: number | null }[] = [
	{ label: "No reminder", value: null },
	{ label: "5 minutes before", value: 5 },
	{ label: "10 minutes before", value: 10 },
	{ label: "15 minutes before", value: 15 },
	{ label: "30 minutes before", value: 30 },
	{ label: "1 hour before", value: 60 },
	{ label: "1 day before", value: 1440 },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function nextHalfHour(): Date {
	const d = new Date();
	d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
	return d;
}

interface FormState {
	title: string;
	type: MeetingType;
	date: string; // yyyy-MM-dd
	startTime: string; // HH:mm
	endTime: string; // HH:mm
	timezone: string;
	videoOption: VideoOption;
	meetingUrl: string;
	selectedMembers: string[];
	guestEmails: string[];
	location: string;
	description: string;
	reminderMinutes: number | null;
	recurrence: string | null; // rrule body, or null for no repeat (create only)
}

function initialState(
	meeting: Meeting | null | undefined,
	defaultType: MeetingType,
	defaultStart?: Date,
): FormState {
	if (meeting) {
		const tz = meeting.timezone || localTimeZone();
		const start = utcToZonedParts(meeting.scheduled_at, tz);
		const endIso =
			meeting.ends_at ??
			addMinutes(
				new Date(meeting.scheduled_at),
				meeting.duration_minutes ?? 30,
			).toISOString();
		const end = utcToZonedParts(endIso, tz);
		return {
			title: meeting.title,
			type: meeting.type,
			date: start.date,
			startTime: start.time,
			endTime: end.time,
			timezone: tz,
			videoOption:
				meeting.video_provider === "none"
					? "none"
					: meeting.video_provider === "jitsi"
						? "jitsi"
						: "external_link",
			meetingUrl: meeting.meeting_url ?? "",
			selectedMembers: (meeting.participants ?? [])
				.filter((p) => p.user_id && p.role !== "host")
				.map((p) => p.user_id as string),
			guestEmails: (meeting.participants ?? [])
				.filter((p) => !p.user_id && p.guest_email)
				.map((p) => p.guest_email as string),
			location: meeting.location ?? "",
			description: meeting.description ?? "",
			reminderMinutes: meeting.reminder_minutes ?? null,
			recurrence: null,
		};
	}
	const start = defaultStart ?? nextHalfHour();
	return {
		title: "",
		type: defaultType,
		date: format(start, "yyyy-MM-dd"),
		startTime: format(start, "HH:mm"),
		endTime: format(addMinutes(start, 30), "HH:mm"),
		timezone: localTimeZone(),
		videoOption: "jitsi",
		meetingUrl: "",
		selectedMembers: [],
		guestEmails: [],
		location: "",
		description: "",
		reminderMinutes: 30,
		recurrence: null,
	};
}

export function MeetingEditorModal({
	open,
	onClose,
	projectId,
	members = [],
	defaultType = "status_sync",
	defaultStart,
	meeting,
	onSaved,
}: MeetingEditorModalProps) {
	const isEdit = !!meeting;
	const [form, setForm] = useState<FormState>(() =>
		initialState(meeting, defaultType, defaultStart),
	);
	const [emailDraft, setEmailDraft] = useState("");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [scopeOpen, setScopeOpen] = useState(false);
	const pendingPayload = useRef<UpdateMeetingPayload | null>(null);

	const bookMutation = useBookMeeting();
	const updateMutation = useUpdateMeeting();
	const isSaving = bookMutation.isPending || updateMutation.isPending;

	// Re-seed the form whenever the modal opens (or its target changes).
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-seed on open/target only.
	useEffect(() => {
		if (open) {
			setForm(initialState(meeting, defaultType, defaultStart));
			setEmailDraft("");
			setErrorMessage(null);
		}
	}, [open, meeting?.id]);

	const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
		setForm((f) => ({ ...f, [key]: value }));

	const dateObj = useMemo(() => {
		const [y, m, d] = form.date.split("-").map(Number);
		return new Date(y, (m || 1) - 1, d || 1);
	}, [form.date]);

	const toggleMember = (id: string) =>
		set(
			"selectedMembers",
			form.selectedMembers.includes(id)
				? form.selectedMembers.filter((m) => m !== id)
				: [...form.selectedMembers, id],
		);

	const addEmail = () => {
		const e = emailDraft.trim().toLowerCase();
		if (!e) return;
		if (!EMAIL_RE.test(e)) {
			setErrorMessage("That doesn't look like a valid email.");
			return;
		}
		if (!form.guestEmails.includes(e)) {
			set("guestEmails", [...form.guestEmails, e]);
		}
		setEmailDraft("");
		setErrorMessage(null);
	};

	if (!open) return null;

	const doUpdate = (id: string, payload: UpdateMeetingPayload) => {
		updateMutation.mutate(
			{ id, payload },
			{
				onSuccess: (m) => {
					onSaved?.(m);
					onClose();
				},
				onError: (err: unknown) =>
					setErrorMessage(
						err instanceof Error ? err.message : "Failed to save meeting.",
					),
			},
		);
	};

	const pickScope = (scope: MeetingEditScope) => {
		setScopeOpen(false);
		if (meeting && pendingPayload.current) {
			doUpdate(meeting.id, { ...pendingPayload.current, scope });
			pendingPayload.current = null;
		}
	};

	const submit = () => {
		setErrorMessage(null);
		if (!form.title.trim()) {
			setErrorMessage("Give the meeting a title.");
			return;
		}
		const startISO = wallTimeToUtcISO(form.date, form.startTime, form.timezone);
		const endISO = wallTimeToUtcISO(form.date, form.endTime, form.timezone);
		const duration = diffMinutes(startISO, endISO);
		if (duration <= 0) {
			setErrorMessage("The end time must be after the start time.");
			return;
		}
		if (form.videoOption === "external_link" && !form.meetingUrl.trim()) {
			setErrorMessage("Paste the meeting link, or pick another video option.");
			return;
		}

		const meetingUrl =
			form.videoOption === "external_link" ? form.meetingUrl.trim() : undefined;
		// Only manage the attendee list where members are available (project
		// context); otherwise leave existing participants untouched.
		const participantIds = members.length ? form.selectedMembers : undefined;
		const guestEmails = form.guestEmails.length ? form.guestEmails : undefined;

		if (isEdit && meeting) {
			const payload: UpdateMeetingPayload = {
				title: form.title.trim(),
				type: form.type,
				scheduled_at: startISO,
				duration_minutes: duration,
				timezone: form.timezone,
				video_option: form.videoOption,
				meeting_url: meetingUrl,
				location: form.location.trim(),
				reminder_minutes: form.reminderMinutes ?? undefined,
				description: form.description.trim(),
				participant_ids: participantIds,
				guest_emails: guestEmails,
			};
			// A recurring occurrence prompts for scope (this / following / all).
			if (meeting.series_id) {
				pendingPayload.current = payload;
				setScopeOpen(true);
				return;
			}
			doUpdate(meeting.id, payload);
			return;
		}

		const payload: CreateMeetingPayload = {
			project_id: projectId,
			title: form.title.trim(),
			type: form.type,
			scheduled_at: startISO,
			duration_minutes: duration,
			timezone: form.timezone,
			video_option: form.videoOption,
			meeting_url: meetingUrl,
			location: form.location.trim() || undefined,
			reminder_minutes: form.reminderMinutes ?? undefined,
			description: form.description.trim() || undefined,
			participant_ids: participantIds,
			guest_emails: guestEmails,
			recurrence: form.recurrence ?? undefined,
		};
		bookMutation.mutate(payload, {
			onSuccess: (m) => {
				onSaved?.(m);
				onClose();
			},
			onError: (err: unknown) =>
				setErrorMessage(
					err instanceof Error ? err.message : "Failed to schedule meeting.",
				),
		});
	};

	return (
		<ModalPortal>
			<div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4">
				<div className="thin-scrollbar max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-xl">
					{/* Header + hero title */}
					<div className="sticky top-0 z-10 rounded-t-2xl border-b border-gray-100 bg-white px-5 pt-4 pb-3">
						<div className="mb-1 flex items-start justify-between gap-3">
							<input
								value={form.title}
								onChange={(e) => set("title", e.target.value)}
								placeholder="Add title"
								className="w-full border-0 border-b border-gray-300 bg-transparent px-0 py-1.5 text-xl focus:border-primary focus:outline-none focus:ring-0 placeholder:text-gray-400"
							/>
							<button
								type="button"
								onClick={onClose}
								aria-label="Close"
								className="mt-1 shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
							>
								<X className="h-4 w-4" />
							</button>
						</div>
					</div>

					<div className="space-y-4 px-5 py-4">
						{/* Type */}
						<Row>
							<select
								value={form.type}
								onChange={(e) => set("type", e.target.value as MeetingType)}
								className="w-full border-0 border-b border-gray-300 bg-transparent px-0 py-2 text-sm focus:border-primary focus:outline-none focus:ring-0"
							>
								{TYPE_OPTIONS.map(([value, label]) => (
									<option key={value} value={value}>
										{label}
									</option>
								))}
							</select>
						</Row>

						{/* Date + time */}
						<Row icon={<Clock className="h-4 w-4" />}>
							<div className="flex flex-wrap items-center gap-2">
								<div className="min-w-[11rem] flex-1">
									<DatePickerField
										value={form.date}
										onChange={(v) => set("date", v)}
										ariaLabel="Meeting date"
									/>
								</div>
								<div className="w-28">
									<TimePicker
										value={form.startTime}
										onChange={(v) => set("startTime", v)}
										ariaLabel="Start time"
									/>
								</div>
								<span className="text-gray-400">–</span>
								<div className="w-28">
									<TimePicker
										value={form.endTime}
										onChange={(v) => set("endTime", v)}
										minTime={form.startTime}
										ariaLabel="End time"
									/>
								</div>
							</div>
						</Row>

						{/* Timezone */}
						<Row>
							<TimezoneSelect
								value={form.timezone}
								onChange={(v) => set("timezone", v)}
								at={dateObj}
							/>
						</Row>

						{/* Repeat — editable on create; a static badge for a recurring
						    occurrence (pattern changes beyond fields land in a later phase). */}
						{!isEdit ? (
							<Row icon={<Repeat className="h-4 w-4" />}>
								<RepeatDropdown
									startDate={dateObj}
									value={form.recurrence}
									onChange={(r) => set("recurrence", r)}
								/>
							</Row>
						) : meeting?.series_id ? (
							<Row icon={<Repeat className="h-4 w-4" />}>
								<span className="py-2 text-sm text-gray-600">
									Recurring event
								</span>
							</Row>
						) : null}

						{/* Video */}
						<Row icon={<Video className="h-4 w-4" />}>
							<VideoProviderPicker
								option={form.videoOption}
								meetingUrl={form.meetingUrl}
								onOptionChange={(o) => set("videoOption", o)}
								onUrlChange={(u) => set("meetingUrl", u)}
							/>
						</Row>

						{/* Guests */}
						<Row icon={<Users className="h-4 w-4" />}>
							<div className="space-y-2">
								{members.length > 0 && (
									<div className="max-h-40 overflow-y-auto rounded-xl border border-gray-200 thin-scrollbar divide-y divide-gray-100">
										{members.map((member) => (
											<label
												key={member.id}
												className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50"
											>
												<input
													type="checkbox"
													checked={form.selectedMembers.includes(member.id)}
													onChange={() => toggleMember(member.id)}
													className="accent-primary"
												/>
												<span className="text-gray-800">{member.name}</span>
											</label>
										))}
									</div>
								)}
								<div>
									<div className="flex flex-wrap gap-1.5">
										{form.guestEmails.map((email) => (
											<span
												key={email}
												className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
											>
												{email}
												<button
													type="button"
													aria-label={`Remove ${email}`}
													onClick={() =>
														set(
															"guestEmails",
															form.guestEmails.filter((g) => g !== email),
														)
													}
													className="text-gray-400 hover:text-gray-600"
												>
													<X className="h-3 w-3" />
												</button>
											</span>
										))}
									</div>
									<input
										value={emailDraft}
										onChange={(e) => setEmailDraft(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter" || e.key === ",") {
												e.preventDefault();
												addEmail();
											}
										}}
										onBlur={addEmail}
										placeholder="Add guests by email"
										className="mt-1 w-full border-0 border-b border-gray-300 bg-transparent px-0 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-0"
									/>
								</div>
							</div>
						</Row>

						{/* Location */}
						<Row icon={<MapPin className="h-4 w-4" />}>
							<input
								value={form.location}
								onChange={(e) => set("location", e.target.value)}
								placeholder="Add location"
								className="w-full border-0 border-b border-gray-300 bg-transparent px-0 py-2 text-sm focus:border-primary focus:outline-none focus:ring-0"
							/>
						</Row>

						{/* Reminder */}
						<Row icon={<Bell className="h-4 w-4" />}>
							<select
								value={form.reminderMinutes ?? ""}
								onChange={(e) =>
									set(
										"reminderMinutes",
										e.target.value === "" ? null : Number(e.target.value),
									)
								}
								className="w-full border-0 border-b border-gray-300 bg-transparent px-0 py-2 text-sm focus:border-primary focus:outline-none focus:ring-0"
							>
								{REMINDER_OPTIONS.map((opt) => (
									<option key={opt.label} value={opt.value ?? ""}>
										{opt.label}
									</option>
								))}
							</select>
						</Row>

						{/* Description */}
						<Row icon={<AlignLeft className="h-4 w-4" />}>
							<textarea
								value={form.description}
								onChange={(e) => set("description", e.target.value)}
								placeholder="Add description"
								rows={3}
								className="w-full resize-none border-0 border-b border-gray-300 bg-transparent px-0 py-2 text-sm focus:border-primary focus:outline-none focus:ring-0"
							/>
						</Row>

						{errorMessage && (
							<div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
								{errorMessage}
							</div>
						)}
					</div>

					{/* Footer */}
					<div className="sticky bottom-0 flex justify-end gap-2 rounded-b-2xl border-t border-gray-100 bg-white px-5 py-4">
						<button
							type="button"
							onClick={onClose}
							className="rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
						>
							Cancel
						</button>
						<button
							type="button"
							disabled={isSaving}
							onClick={submit}
							className="rounded-xl bg-primary px-5 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
						>
							{isSaving ? (
								<span className="inline-flex items-center gap-2">
									<Loader2 className="h-4 w-4 animate-spin" />
									Saving…
								</span>
							) : isEdit ? (
								"Save"
							) : (
								"Schedule"
							)}
						</button>
					</div>
				</div>
			</div>

			<ScopeDialog
				open={scopeOpen}
				action="edit"
				onClose={() => setScopeOpen(false)}
				onPick={pickScope}
			/>
		</ModalPortal>
	);
}

function Row({
	icon,
	children,
}: {
	icon?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div className="flex gap-3">
			<span className="mt-2 w-4 shrink-0 text-gray-400">{icon}</span>
			<div className="min-w-0 flex-1">{children}</div>
		</div>
	);
}
