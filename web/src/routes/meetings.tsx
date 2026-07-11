import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { CalendarShell } from "@/components/meetings/calendar/CalendarShell";
import { MeetingEditorModal } from "@/components/meetings/editor/MeetingEditorModal";
import { useToast } from "@/hooks/useToast";
import { meetingKeys } from "@/queries/meetings";
import type { Meeting } from "@/services/meetings.service";
import { useAuthStore, useUser } from "@/stores/authStore";

export const Route = createFileRoute("/meetings")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) throw redirect({ to: "/auth/login" });
	},
	component: MeetingsPage,
});

function MeetingsPage() {
	const user = useUser();
	const toast = useToast();
	const queryClient = useQueryClient();
	const [editorOpen, setEditorOpen] = useState(false);
	const [editorMeeting, setEditorMeeting] = useState<Meeting | null>(null);
	const [editorStart, setEditorStart] = useState<Date | undefined>(undefined);

	// The Google OAuth callback redirects back here with ?google=connected|error.
	// biome-ignore lint/correctness/useExhaustiveDependencies: handle the return once on mount.
	useEffect(() => {
		const result = new URLSearchParams(window.location.search).get("google");
		if (!result) return;
		if (result === "connected") {
			toast.success("Google Calendar connected.");
			queryClient.invalidateQueries({ queryKey: meetingKeys.googleStatus() });
		} else {
			toast.error("Couldn't connect Google Calendar. Please try again.");
		}
		window.history.replaceState({}, "", window.location.pathname);
	}, []);

	const openCreate = (at?: Date) => {
		setEditorMeeting(null);
		setEditorStart(at);
		setEditorOpen(true);
	};
	const openEdit = (meeting: Meeting) => {
		setEditorStart(undefined);
		setEditorMeeting(meeting);
		setEditorOpen(true);
	};

	return (
		<DashboardShell>
			{/* On desktop, fill the viewport below the fixed app header so the
			    calendar uses the whole screen instead of a short, centered box.
			    On mobile the page flows naturally (the grid keeps a height floor). */}
			<div className="flex min-h-0 flex-col p-4 lg:h-[calc(100vh-3.5rem-var(--safe-top))]">
				<CalendarShell
					currentUserId={user?.id}
					onCreate={openCreate}
					onEditMeeting={openEdit}
				/>
			</div>

			<MeetingEditorModal
				open={editorOpen}
				onClose={() => setEditorOpen(false)}
				meeting={editorMeeting}
				defaultStart={editorStart}
			/>
		</DashboardShell>
	);
}
