import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/authStore";
import { getFreelancerStage } from "@/lib/freelancer-stage";
import { meetingKeys } from "@/queries/meetings";
import { meetingsService } from "@/services/meetings.service";

type CalendarEvent = {
  id: string;
  title: string;
  startsAt: string;
};

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function formatMonth(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function formatTodayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function buildMonthGrid(currentMonth: Date): Date[] {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const start = new Date(firstDay);
  start.setDate(firstDay.getDate() - firstDay.getDay());

  return Array.from({ length: 7 }, (_, index) => {
    const cellDate = new Date(start);
    cellDate.setDate(start.getDate() + index);
    return cellDate;
  });
}

export function CalendarWidget() {
  const { profile } = useAuthStore();
  const persona = profile?.active_persona || "client";
  const isActivated = Boolean(profile?.has_completed_onboarding);
  const stage = getFreelancerStage(profile);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // Real upcoming meetings for the agenda. Fetched over a stable forward window
  // once the account is activated; while empty (or dark), the empty-state copy
  // below is the graceful fallback.
  const range = useMemo(() => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date();
    to.setDate(to.getDate() + 45);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);
  const meetingsQuery = useQuery({
    queryKey: meetingKeys.list(range),
    queryFn: () => meetingsService.list(range),
    enabled: isActivated,
    staleTime: 1000 * 60,
  });
  const events: CalendarEvent[] = useMemo(
    () =>
      (meetingsQuery.data ?? [])
        .filter((m) => m.status === "scheduled")
        .map((m) => ({ id: m.id, title: m.title, startsAt: m.scheduled_at })),
    [meetingsQuery.data],
  );
  const today = new Date();
  const todayEvents = events.filter((event) => {
    const startsAt = new Date(event.startsAt);
    return (
      startsAt.getDate() === today.getDate() &&
      startsAt.getMonth() === today.getMonth() &&
      startsAt.getFullYear() === today.getFullYear()
    );
  });
  const upcomingEvents = events
    .filter((event) => new Date(event.startsAt).getTime() > today.getTime())
    .slice(0, 4);
  const monthCells = useMemo(() => buildMonthGrid(currentMonth), [currentMonth]);
  // Dot the days that actually have a scheduled meeting.
  const matchingPulseDates = useMemo(
    () => events.map((event) => new Date(event.startsAt)),
    [events],
  );

  const emptyState =
    persona === "freelancer"
      ? {
          title: "Your delivery schedule will appear here",
          description:
            "After you are matched to a project, consultant sessions and milestone check-ins are added automatically.",
          todayMessage:
            "Matching is in progress. Keep your profile current while consultant reviews continue.",
          upcomingMessage:
            isActivated
              ? "Your first session will appear once you're matched to a project roadmap."
              : "Complete activation to unlock your first matching call and milestone reminders.",
        }
      : {
          title: "Your project timeline starts here",
          description:
            "Once your project vision is matched with a consultant, kickoff dates and roadmap reviews will populate this calendar.",
          todayMessage:
            "No scheduled items for today. Project kickoff events appear after matching.",
          upcomingMessage:
            "Upcoming roadmap reviews and milestone approvals will appear here.",
        };

  const expectedDays =
    stage === "onboarding" ? 7 : stage === "matching" ? 3 : stage === "assigned" ? 1 : 0;

  return (
    <div 
      className="bg-white rounded-xl shadow-sm overflow-hidden" 
      data-theme={persona}
    >
      <div 
        className="text-white text-center py-3"
        style={{ backgroundColor: "var(--secondary)" }}
      >
        <h3 className="text-[20px] font-semibold">SCHEDULE</h3>
      </div>

      <div className="bg-[#f6f7f8] p-8">
        <div className="flex items-center justify-between mb-6">
          <h4 className="text-[18px] font-bold text-black">
            {formatMonth(currentMonth)}
          </h4>
          <div className="flex gap-3">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() =>
                setCurrentMonth(
                  (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1),
                )
              }
            >
              <ChevronLeft className="w-6 h-6 cursor-pointer text-black" />
            </button>
            <button
              type="button"
              aria-label="Next month"
              onClick={() =>
                setCurrentMonth(
                  (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1),
                )
              }
            >
              <ChevronRight className="w-6 h-6 cursor-pointer text-black" />
            </button>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-0 text-center text-[18px] mb-4">
          {WEEKDAYS.map((day, i) => (
            <div
              key={i}
              className="w-[42px] h-[42px] flex items-center justify-center text-black"
            >
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-0 text-center text-[18px]">
          {monthCells.map((cellDate, i) => {
            const isCurrentMonth = cellDate.getMonth() === currentMonth.getMonth();
            const isToday =
              cellDate.getDate() === today.getDate() &&
              cellDate.getMonth() === today.getMonth() &&
              cellDate.getFullYear() === today.getFullYear();
            const isSelected =
              selectedDate &&
              cellDate.getDate() === selectedDate.getDate() &&
              cellDate.getMonth() === selectedDate.getMonth() &&
              cellDate.getFullYear() === selectedDate.getFullYear();
            const hasPulse = matchingPulseDates.some(
              (pulseDate) =>
                pulseDate.getDate() === cellDate.getDate() &&
                pulseDate.getMonth() === cellDate.getMonth() &&
                pulseDate.getFullYear() === cellDate.getFullYear(),
            );

            return (
            <button
              type="button"
              key={i}
              className={`w-[42px] h-[42px] flex items-center justify-center ${
                isToday ? "text-white rounded-[5px] font-semibold" : "text-black hover:bg-[#e9edf3] rounded-[5px]"
              } ${isCurrentMonth ? "" : "opacity-40"}`}
              style={isToday || isSelected ? { backgroundColor: "var(--secondary)" } : {}}
              onClick={() => setSelectedDate(cellDate)}
              aria-label={`Open schedule for ${cellDate.toDateString()}`}
              title={isToday ? "Today" : `Open ${cellDate.toDateString()}`}
            >
              <span className="relative inline-flex items-center justify-center">
                {cellDate.getDate()}
                {hasPulse ? (
                  <span className="absolute -bottom-2 w-1.5 h-1.5 rounded-full bg-[#92969f]" />
                ) : null}
              </span>
            </button>
            );
          })}
        </div>
      </div>

      {/* Agenda */}
      <div className="bg-white p-8 max-h-[219px] overflow-y-auto hide-scrollbar">
        <div className="space-y-4">
          <div>
            <p className="text-[16px] font-semibold mb-2" style={{ color: "var(--secondary)" }}>
              Today • {formatTodayLabel(today)}
            </p>
            <p className="text-xs font-semibold text-[#61636c] mb-1">TODAY'S SCHEDULE</p>
            {todayEvents.length === 0 ? (
              <p className="text-[13px] text-[#61636c]">{emptyState.todayMessage}</p>
            ) : (
              <div className="space-y-2 text-[14px]">
                {todayEvents.map((event) => (
                  <AgendaItem
                    key={event.id}
                    time={new Date(event.startsAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    title={event.title}
                  />
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold text-[#61636c] mb-1">NEXT EVENT</p>
            {upcomingEvents.length === 0 ? (
              <p className="text-[13px] text-[#61636c]">{emptyState.upcomingMessage}</p>
            ) : (
              <div className="space-y-2 text-[14px]">
                {upcomingEvents.map((event) => (
                  <AgendaItem
                    key={event.id}
                    time={new Date(event.startsAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    title={event.title}
                  />
                ))}
              </div>
            )}
          </div>

          {persona === "freelancer" && expectedDays > 0 ? (
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-semibold text-[#61636c] mb-1">EXPECTED TIMELINE</p>
              <p className="text-[13px] text-[#61636c]">
                Your first session is expected in about {expectedDays} day{expectedDays > 1 ? "s" : ""} as matching progresses.
              </p>
            </div>
          ) : null}

          {selectedDate ? (
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-semibold text-[#61636c] mb-1">
                SELECTED DATE
              </p>
              <p className="text-[13px] text-[#61636c]">
                No events scheduled for {selectedDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}. Your first session will appear once you're matched.
              </p>
            </div>
          ) : null}

          {events.length === 0 ? (
            <div className="text-center py-1 border-t border-gray-100 pt-3">
            <p className="text-[16px] font-semibold text-[#333438] mb-1">
              {emptyState.title}
            </p>
            <p className="text-[14px] text-[#61636c]">{emptyState.description}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AgendaItem({ time, title }: { time: string; title: string }) {
  return (
    <div className="flex items-center gap-4 py-2 border-b border-gray-200">
      <span className="text-[16px] text-[#333438] w-[70px] shrink-0">
        {time}
      </span>
      <div className="flex items-center gap-3 flex-1">
        <div className="w-4 h-4 rounded-full bg-gray-300 shrink-0" />
        <span className="text-[14px] text-[#333438]">{title}</span>
      </div>
    </div>
  );
}
