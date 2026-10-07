import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/useToast";
import { meetingKeys } from "@/queries/meetings";
import {
	type CreateMeetingPayload,
	type GoogleReturnPath,
	googleCalendarService,
	isGoogleReconnectError,
	type ListMeetingsParams,
	type MeetingEditScope,
	meetingsService,
	type ParticipantResponse,
	type RescheduleMeetingPayload,
	type UpdateMeetingPayload,
} from "@/services/meetings.service";

export function useMeetingsRange(params: ListMeetingsParams, enabled = true) {
	return useQuery({
		queryKey: meetingKeys.list(params),
		queryFn: () => meetingsService.list(params),
		enabled,
		staleTime: 1000 * 30,
	});
}

export function useProjectMeetings(
	projectId: string | undefined,
	params?: ListMeetingsParams,
) {
	return useQuery({
		queryKey: meetingKeys.project(projectId ?? "", params),
		queryFn: () => meetingsService.listForProject(projectId as string, params),
		enabled: Boolean(projectId),
		staleTime: 1000 * 30,
	});
}

export function useMeeting(id: string | undefined) {
	return useQuery({
		queryKey: meetingKeys.detail(id ?? ""),
		queryFn: () => meetingsService.get(id as string),
		enabled: Boolean(id),
	});
}

/** Invalidate every meeting list/detail so calendars + the dashboard widget refresh. */
function useInvalidateMeetings() {
	const queryClient = useQueryClient();
	return () => queryClient.invalidateQueries({ queryKey: meetingKeys.all });
}

/**
 * When the API says Google access was revoked, the backend has already dropped
 * the connection; refetch status so the UI offers "Connect" again.
 */
function useRefreshGoogleOnReconnect() {
	const queryClient = useQueryClient();
	return (error: unknown) => {
		if (isGoogleReconnectError(error)) {
			queryClient.invalidateQueries({ queryKey: meetingKeys.googleStatus() });
			queryClient.removeQueries({ queryKey: meetingKeys.googleEventsAll() });
		}
	};
}

export function useBookMeeting() {
	const invalidate = useInvalidateMeetings();
	const refreshGoogle = useRefreshGoogleOnReconnect();
	return useMutation({
		mutationFn: (payload: CreateMeetingPayload) =>
			meetingsService.create(payload),
		onSuccess: invalidate,
		onError: refreshGoogle,
	});
}

export function useCancelMeeting() {
	const invalidate = useInvalidateMeetings();
	return useMutation({
		mutationFn: (args: string | { id: string; scope?: MeetingEditScope }) =>
			typeof args === "string"
				? meetingsService.cancel(args)
				: meetingsService.cancel(args.id, args.scope),
		onSuccess: invalidate,
	});
}

export function useRescheduleMeeting() {
	const invalidate = useInvalidateMeetings();
	return useMutation({
		mutationFn: (args: { id: string; payload: RescheduleMeetingPayload }) =>
			meetingsService.reschedule(args.id, args.payload),
		onSuccess: invalidate,
	});
}

export function useUpdateMeeting() {
	const invalidate = useInvalidateMeetings();
	const refreshGoogle = useRefreshGoogleOnReconnect();
	return useMutation({
		mutationFn: (args: { id: string; payload: UpdateMeetingPayload }) =>
			meetingsService.update(args.id, args.payload),
		onSuccess: invalidate,
		onError: refreshGoogle,
	});
}

export function useRespondMeeting() {
	const invalidate = useInvalidateMeetings();
	return useMutation({
		mutationFn: (args: {
			id: string;
			response: Exclude<ParticipantResponse, "pending">;
		}) => meetingsService.respond(args.id, args.response),
		onSuccess: invalidate,
	});
}

/** The current user's Google Calendar connection status (drives the Meet option). */
export function useGoogleCalendarStatus(enabled = true) {
	return useQuery({
		queryKey: meetingKeys.googleStatus(),
		queryFn: () => googleCalendarService.status(),
		enabled,
		staleTime: 1000 * 60,
	});
}

export function useDisconnectGoogleCalendar() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () => googleCalendarService.disconnect(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: meetingKeys.googleStatus() });
			queryClient.removeQueries({ queryKey: meetingKeys.googleEventsAll() });
		},
	});
}

/**
 * The user's own Google events for a calendar range (the read-only overlay).
 * Fetched live from Google through the backend; a revoked grant flips the
 * status query back to "not connected" instead of retrying.
 */
export function useGoogleCalendarEvents(
	range: { from: string; to: string },
	enabled: boolean,
) {
	const refreshGoogle = useRefreshGoogleOnReconnect();
	const query = useQuery({
		queryKey: meetingKeys.googleEvents(range),
		queryFn: () => googleCalendarService.events(range),
		enabled,
		staleTime: 1000 * 60,
		retry: (failureCount, error) =>
			!isGoogleReconnectError(error) && failureCount < 1,
	});
	const { error } = query;
	useEffect(() => {
		if (error) refreshGoogle(error);
	}, [error]);
	return query;
}

/**
 * Start the Google consent flow (a full-page redirect). The backend callback
 * returns the browser to `returnTo` with `?google=connected|error`, which
 * `useGoogleConnectResult` turns into a toast.
 */
export function useConnectGoogleCalendar(returnTo: GoogleReturnPath) {
	const [connecting, setConnecting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const connect = async () => {
		setConnecting(true);
		setError(null);
		try {
			window.location.href = await googleCalendarService.connectUrl(returnTo);
		} catch (err) {
			setConnecting(false);
			setError(
				err instanceof Error
					? err.message
					: "Couldn't start Google connection.",
			);
		}
	};
	return { connect, connecting, error };
}

const GOOGLE_CONNECT_ERRORS: Record<string, string> = {
	denied: "Google Calendar wasn't connected: access was not granted.",
	expired: "The Google sign-in took too long. Please try again.",
};

/**
 * Handle the return from Google's consent screen (`?google=connected|error`):
 * show a toast, refresh the connection status, and clean the URL. Mount it on
 * every page listed in `GoogleReturnPath`.
 */
export function useGoogleConnectResult() {
	const toast = useToast();
	const queryClient = useQueryClient();
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const result = params.get("google");
		if (!result) return;
		if (result === "connected") {
			toast.success("Google Calendar connected.");
			queryClient.invalidateQueries({ queryKey: meetingKeys.googleStatus() });
			queryClient.invalidateQueries({
				queryKey: meetingKeys.googleEventsAll(),
			});
		} else {
			toast.error(
				GOOGLE_CONNECT_ERRORS[params.get("reason") ?? ""] ??
					"Couldn't connect Google Calendar. Please try again.",
			);
		}
		window.history.replaceState({}, "", window.location.pathname);
	}, []);
}
