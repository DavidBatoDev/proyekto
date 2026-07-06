import { useMemo, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { CalendarPlus, Loader2 } from "lucide-react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { MeetingsCalendar } from "@/components/meetings/MeetingsCalendar";
import { BookMeetingModal } from "@/components/meetings/BookMeetingModal";
import { useMeetingsRange } from "@/hooks/useMeetings";
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
  const [bookOpen, setBookOpen] = useState(false);

  // A wide, stable window so month-to-month navigation inside the calendar has
  // data without refetching on every render. Computed once per mount.
  const range = useMemo(() => {
    const from = new Date();
    from.setDate(from.getDate() - 60);
    const to = new Date();
    to.setDate(to.getDate() + 120);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);

  const meetingsQuery = useMeetingsRange(range);
  const meetings = meetingsQuery.data ?? [];

  return (
    <DashboardShell>
      <div className="space-y-5 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Meetings</h1>
            <p className="text-sm text-gray-500">
              Your scheduled calls and sessions.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setBookOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            <CalendarPlus className="w-4 h-4" /> Schedule meeting
          </button>
        </div>

        {meetingsQuery.isPending ? (
          <div className="flex justify-center p-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : meetingsQuery.isError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Failed to load meetings. Please try again.
          </div>
        ) : (
          <MeetingsCalendar meetings={meetings} currentUserId={user?.id} />
        )}
      </div>

      <BookMeetingModal open={bookOpen} onClose={() => setBookOpen(false)} />
    </DashboardShell>
  );
}
