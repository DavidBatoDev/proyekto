import apiClient from "@/api/axios";

export type MeetingStatus =
	| "scheduled"
	| "cancelled"
	| "completed"
	| "rescheduled"
	| "no_show";

export type MeetingType =
	| "kickoff"
	| "status_sync"
	| "design_review"
	| "qa"
	| "scope_clarification"
	| "retainer_sync"
	| "client_consultant"
	| "consultant_freelancer"
	| "consultation";

export type VideoProvider = "none" | "external_link" | "jitsi" | "google_meet";

// Editor-selectable options. 'google_meet' is only offered when Google OAuth is
// enabled AND the organizer has connected their account (see googleCalendar).
export type VideoOption = "none" | "jitsi" | "external_link" | "google_meet";

export type ParticipantResponse =
	| "pending"
	| "accepted"
	| "declined"
	| "tentative";

export interface MeetingParticipant {
	id: string;
	user_id: string | null;
	guest_email: string | null;
	guest_name: string | null;
	role: string;
	response: ParticipantResponse;
}

export interface Meeting {
	id: string;
	project_id: string | null;
	host_id: string | null;
	created_by: string | null;
	title: string;
	description: string | null;
	type: MeetingType;
	scheduled_at: string;
	ends_at: string | null;
	duration_minutes: number | null;
	status: MeetingStatus;
	video_provider: VideoProvider;
	meeting_url: string | null;
	google_event_id: string | null;
	timezone: string | null;
	location: string | null;
	reminder_minutes: number | null;
	reschedule_of: string | null;
	series_id: string | null;
	recurrence_id: string | null;
	original_start: string | null;
	is_exception: boolean;
	created_at: string;
	updated_at: string;
	participants?: MeetingParticipant[];
}

export interface ListMeetingsParams {
	from?: string;
	to?: string;
	status?: MeetingStatus;
	project_id?: string;
}

export interface CreateMeetingPayload {
	project_id?: string;
	title: string;
	description?: string;
	type: MeetingType;
	scheduled_at: string;
	duration_minutes?: number;
	timezone?: string;
	video_option?: VideoOption;
	meeting_url?: string;
	participant_ids?: string[];
	guest_emails?: string[];
	location?: string;
	reminder_minutes?: number;
	// RFC-5545 rule body (no DTSTART) — when set, creates a recurring series.
	recurrence?: string;
}

export interface RescheduleMeetingPayload {
	scheduled_at: string;
	duration_minutes?: number;
	timezone?: string;
}

export type MeetingEditScope = "this" | "following" | "all";

// General field edit — every field optional; only provided ones change.
export interface UpdateMeetingPayload {
	title?: string;
	description?: string;
	type?: MeetingType;
	scheduled_at?: string;
	duration_minutes?: number;
	timezone?: string;
	location?: string;
	reminder_minutes?: number;
	video_option?: VideoOption;
	meeting_url?: string;
	participant_ids?: string[];
	guest_emails?: string[];
	// New pattern when editing a series with scope 'all' / 'following'.
	recurrence?: string;
	scope?: MeetingEditScope;
}

// Human-facing labels for the meeting_type enum, used in booking forms + lists.
export const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
	kickoff: "Kickoff",
	status_sync: "Status sync",
	design_review: "Design review",
	qa: "QA",
	scope_clarification: "Scope clarification",
	retainer_sync: "Retainer sync",
	client_consultant: "Client ↔ Consultant",
	consultant_freelancer: "Consultant ↔ Freelancer",
	consultation: "Consultation",
};

type ApiResponse<T> = { data: T };

function extractError(error: unknown, fallback: string): Error {
	const e = error as {
		response?: {
			status?: number;
			data?: { error?: { message?: string }; message?: string };
		};
		message?: string;
	};
	const message =
		e?.response?.data?.error?.message ||
		e?.response?.data?.message ||
		e?.message ||
		fallback;
	const wrapped = new Error(message) as Error & {
		status?: number;
		cause?: unknown;
	};
	wrapped.status = e?.response?.status;
	wrapped.cause = error;
	return wrapped;
}

export const meetingsService = {
	async list(params?: ListMeetingsParams): Promise<Meeting[]> {
		try {
			const res = await apiClient.get<ApiResponse<Meeting[]>>("/api/meetings", {
				params,
			});
			return res.data.data ?? [];
		} catch (e) {
			throw extractError(e, "Failed to load meetings");
		}
	},

	async listForProject(
		projectId: string,
		params?: ListMeetingsParams,
	): Promise<Meeting[]> {
		try {
			const res = await apiClient.get<ApiResponse<Meeting[]>>(
				`/api/meetings/project/${projectId}`,
				{ params },
			);
			return res.data.data ?? [];
		} catch (e) {
			throw extractError(e, "Failed to load project meetings");
		}
	},

	async get(id: string): Promise<Meeting> {
		try {
			const res = await apiClient.get<ApiResponse<Meeting>>(
				`/api/meetings/${id}`,
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to load meeting");
		}
	},

	async create(payload: CreateMeetingPayload): Promise<Meeting> {
		try {
			const res = await apiClient.post<ApiResponse<Meeting>>(
				"/api/meetings",
				payload,
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to schedule meeting");
		}
	},

	async reschedule(
		id: string,
		payload: RescheduleMeetingPayload,
	): Promise<Meeting> {
		try {
			const res = await apiClient.patch<ApiResponse<Meeting>>(
				`/api/meetings/${id}`,
				payload,
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to reschedule meeting");
		}
	},

	async update(id: string, payload: UpdateMeetingPayload): Promise<Meeting> {
		try {
			const res = await apiClient.patch<ApiResponse<Meeting>>(
				`/api/meetings/${id}/details`,
				payload,
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to update meeting");
		}
	},

	async cancel(id: string, scope?: MeetingEditScope): Promise<Meeting> {
		try {
			const res = await apiClient.post<ApiResponse<Meeting>>(
				`/api/meetings/${id}/cancel`,
				scope ? { scope } : {},
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to cancel meeting");
		}
	},

	async respond(
		id: string,
		response: Exclude<ParticipantResponse, "pending">,
	): Promise<MeetingParticipant> {
		try {
			const res = await apiClient.post<ApiResponse<MeetingParticipant>>(
				`/api/meetings/${id}/respond`,
				{ response },
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to respond to meeting");
		}
	},
};

// ── Google Calendar / Meet connection ───────────────────────────────────────

export interface GoogleCalendarStatus {
	// False when the feature isn't enabled in this environment — the editor then
	// hides the Google Meet option entirely.
	enabled: boolean;
	connected: boolean;
	googleEmail?: string | null;
}

export const googleCalendarService = {
	async status(): Promise<GoogleCalendarStatus> {
		try {
			const res = await apiClient.get<ApiResponse<GoogleCalendarStatus>>(
				"/api/meetings/google/status",
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to load Google Calendar status");
		}
	},

	// Returns the Google consent URL — the caller redirects the browser to it.
	async connectUrl(): Promise<string> {
		try {
			const res = await apiClient.get<ApiResponse<{ url: string }>>(
				"/api/meetings/google/connect",
			);
			return res.data.data.url;
		} catch (e) {
			throw extractError(e, "Failed to start Google connection");
		}
	},

	async disconnect(): Promise<void> {
		try {
			await apiClient.delete("/api/meetings/google/connection");
		} catch (e) {
			throw extractError(e, "Failed to disconnect Google Calendar");
		}
	},
};
