import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Video,
} from "lucide-react";
import {
  type Meeting,
  MEETING_TYPE_LABELS,
} from "@/services/meetings.service";
import { useCancelMeeting, useRespondMeeting } from "@/hooks/useMeetings";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function buildMonthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  // 6 weeks = 42 cells, always covers the month.
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

interface MeetingsCalendarProps {
  meetings: Meeting[];
  currentUserId?: string;
}

export function MeetingsCalendar({
  meetings,
  currentUserId,
}: MeetingsCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());

  const cells = useMemo(() => buildMonthGrid(currentMonth), [currentMonth]);

  // Group non-cancelled meetings by local YYYY-MM-DD.
  const byDay = useMemo(() => {
    const map = new Map<string, Meeting[]>();
    for (const m of meetings) {
      if (m.status === "cancelled" || m.status === "rescheduled") continue;
      const d = new Date(m.scheduled_at);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const list = map.get(key) ?? [];
      list.push(m);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          new Date(a.scheduled_at).getTime() -
          new Date(b.scheduled_at).getTime(),
      );
    }
    return map;
  }, [meetings]);

  const meetingsFor = (d: Date): Meeting[] =>
    byDay.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) ?? [];

  const selectedMeetings = meetingsFor(selectedDate);
  const today = new Date();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">
            {format(currentMonth, "MMMM yyyy")}
          </h3>
          <div className="flex gap-1">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() =>
                setCurrentMonth(
                  (p) => new Date(p.getFullYear(), p.getMonth() - 1, 1),
                )
              }
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
                setSelectedDate(now);
              }}
              className="px-2.5 py-1 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100"
            >
              Today
            </button>
            <button
              type="button"
              aria-label="Next month"
              onClick={() =>
                setCurrentMonth(
                  (p) => new Date(p.getFullYear(), p.getMonth() + 1, 1),
                )
              }
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 text-center text-xs font-medium text-gray-400 mb-1">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            const inMonth = d.getMonth() === currentMonth.getMonth();
            const isToday = sameDay(d, today);
            const isSelected = sameDay(d, selectedDate);
            const dayMeetings = meetingsFor(d);
            return (
              <button
                type="button"
                key={i}
                onClick={() => setSelectedDate(new Date(d))}
                className={`min-h-[70px] rounded-lg border p-1.5 text-left align-top transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-gray-100 hover:bg-gray-50"
                } ${inMonth ? "" : "opacity-40"}`}
              >
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                    isToday
                      ? "bg-primary text-white font-semibold"
                      : "text-gray-700"
                  }`}
                >
                  {d.getDate()}
                </span>
                <div className="mt-1 space-y-0.5">
                  {dayMeetings.slice(0, 2).map((m) => (
                    <div
                      key={m.id}
                      className="truncate rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary"
                      title={m.title}
                    >
                      {format(new Date(m.scheduled_at), "p")} {m.title}
                    </div>
                  ))}
                  {dayMeetings.length > 2 && (
                    <div className="px-1 text-[10px] text-gray-400">
                      +{dayMeetings.length - 2} more
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-3">
          <CalendarDays className="w-4 h-4 text-gray-400" />
          <h4 className="text-sm font-semibold text-gray-900">
            {format(selectedDate, "EEEE, MMM d")}
          </h4>
        </div>
        {selectedMeetings.length === 0 ? (
          <p className="text-sm text-gray-500">No meetings scheduled.</p>
        ) : (
          <div className="space-y-3">
            {selectedMeetings.map((m) => (
              <MeetingRow
                key={m.id}
                meeting={m}
                currentUserId={currentUserId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MeetingRow({
  meeting,
  currentUserId,
}: {
  meeting: Meeting;
  currentUserId?: string;
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
    !!myParticipation &&
    myParticipation.role !== "host" &&
    !canManage;

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
            <Video className="w-3.5 h-3.5" /> Join
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
                  respondMutation.mutate({ id: meeting.id, response: "accepted" })
                }
                className="rounded-lg border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-700 hover:bg-green-100 disabled:opacity-60"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={respondMutation.isPending}
                onClick={() =>
                  respondMutation.mutate({ id: meeting.id, response: "declined" })
                }
                className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-60"
              >
                Decline
              </button>
            </>
          )}
          {canManage && (
            <button
              type="button"
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate(meeting.id)}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60"
            >
              {cancelMutation.isPending && (
                <Loader2 className="w-3 h-3 animate-spin" />
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
