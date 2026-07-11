import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { meetingKeys } from "@/queries/meetings";
import {
	type CreateMeetingPayload,
	googleCalendarService,
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

export function useBookMeeting() {
	const invalidate = useInvalidateMeetings();
	return useMutation({
		mutationFn: (payload: CreateMeetingPayload) =>
			meetingsService.create(payload),
		onSuccess: invalidate,
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
	return useMutation({
		mutationFn: (args: { id: string; payload: UpdateMeetingPayload }) =>
			meetingsService.update(args.id, args.payload),
		onSuccess: invalidate,
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
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: meetingKeys.googleStatus() }),
	});
}
