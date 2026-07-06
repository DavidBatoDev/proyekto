import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { ModalPortal } from "@/components/common/ModalPortal";
import {
  type CreateMeetingPayload,
  type Meeting,
  type MeetingType,
  type VideoOption,
  MEETING_TYPE_LABELS,
} from "@/services/meetings.service";
import { useBookMeeting } from "@/hooks/useMeetings";

export interface BookMeetingMember {
  id: string;
  name: string;
}

interface BookMeetingModalProps {
  open: boolean;
  onClose: () => void;
  /** When set, the meeting is scoped to this project (attendees must be members). */
  projectId?: string;
  /** Project members offered as invitees (excluding the current user). */
  members?: BookMeetingMember[];
  defaultType?: MeetingType;
  onBooked?: (meeting: Meeting) => void;
}

const DURATION_OPTIONS = [15, 30, 45, 60, 90];

const TYPE_OPTIONS = Object.entries(MEETING_TYPE_LABELS) as [
  MeetingType,
  string,
][];

// Local "YYYY-MM-DDTHH:mm" string for a <input type="datetime-local"> default,
// rounded to the next half hour.
function defaultLocalDateTime(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function BookMeetingModal({
  open,
  onClose,
  projectId,
  members = [],
  defaultType = "status_sync",
  onBooked,
}: BookMeetingModalProps) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<MeetingType>(defaultType);
  const [localDateTime, setLocalDateTime] = useState(defaultLocalDateTime);
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [videoOption, setVideoOption] = useState<VideoOption>("jitsi");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );

  const bookMutation = useBookMeeting();

  useEffect(() => {
    if (!open) {
      setTitle("");
      setType(defaultType);
      setLocalDateTime(defaultLocalDateTime());
      setDurationMinutes(30);
      setVideoOption("jitsi");
      setMeetingUrl("");
      setSelectedMembers([]);
      setErrorMessage(null);
    }
  }, [open, defaultType]);

  if (!open) return null;

  const toggleMember = (id: string) => {
    setSelectedMembers((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
  };

  const submit = () => {
    setErrorMessage(null);

    if (!title.trim()) {
      setErrorMessage("Give the meeting a title.");
      return;
    }
    const startMs = Date.parse(localDateTime);
    if (Number.isNaN(startMs)) {
      setErrorMessage("Pick a valid date and time.");
      return;
    }
    if (videoOption === "external_link" && !meetingUrl.trim()) {
      setErrorMessage("Paste the meeting link, or switch to an auto-generated room.");
      return;
    }

    const payload: CreateMeetingPayload = {
      project_id: projectId,
      title: title.trim(),
      type,
      scheduled_at: new Date(startMs).toISOString(),
      duration_minutes: durationMinutes,
      timezone,
      video_option: videoOption,
      meeting_url:
        videoOption === "external_link" ? meetingUrl.trim() : undefined,
      participant_ids: selectedMembers.length ? selectedMembers : undefined,
    };

    bookMutation.mutate(payload, {
      onSuccess: (meeting) => {
        onBooked?.(meeting);
        onClose();
      },
      onError: (error: unknown) => {
        setErrorMessage(
          error instanceof Error ? error.message : "Failed to schedule meeting.",
        );
      },
    });
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-gray-200 max-h-[90vh] overflow-y-auto">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Schedule a meeting
              </h3>
              <p className="text-sm text-gray-500">
                Times are shown in your timezone ({timezone}).
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Title
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Kickoff call"
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Type
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as MeetingType)}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {TYPE_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Duration
                </label>
                <select
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {DURATION_OPTIONS.map((mins) => (
                    <option key={mins} value={mins}>
                      {mins} min
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Date & time
              </label>
              <input
                type="datetime-local"
                value={localDateTime}
                onChange={(e) => setLocalDateTime(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Video link
              </label>
              <div className="space-y-2">
                <VideoRadio
                  checked={videoOption === "jitsi"}
                  onSelect={() => setVideoOption("jitsi")}
                  label="Generate a video room automatically"
                  hint="A private meeting link is created for you — no account needed."
                />
                <VideoRadio
                  checked={videoOption === "external_link"}
                  onSelect={() => setVideoOption("external_link")}
                  label="Paste my own link"
                  hint="Use an existing Google Meet, Zoom, or Teams link."
                />
                {videoOption === "external_link" && (
                  <input
                    value={meetingUrl}
                    onChange={(e) => setMeetingUrl(e.target.value)}
                    placeholder="https://meet.google.com/…"
                    className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                )}
                <VideoRadio
                  checked={videoOption === "none"}
                  onSelect={() => setVideoOption("none")}
                  label="No video link"
                  hint="In-person or add a link later."
                />
              </div>
            </div>

            {members.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Invite
                </label>
                <div className="max-h-40 overflow-y-auto rounded-xl border border-gray-200 divide-y divide-gray-100">
                  {members.map((member) => (
                    <label
                      key={member.id}
                      className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedMembers.includes(member.id)}
                        onChange={() => toggleMember(member.id)}
                        className="accent-primary"
                      />
                      <span className="text-gray-800">{member.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {errorMessage && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {errorMessage}
              </div>
            )}
          </div>

          <div className="p-5 border-t border-gray-100 flex justify-end gap-2 sticky bottom-0 bg-white rounded-b-2xl">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={bookMutation.isPending}
              onClick={submit}
              className="px-4 py-2 text-sm rounded-xl bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-60"
            >
              {bookMutation.isPending ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Scheduling...
                </span>
              ) : (
                "Schedule"
              )}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

function VideoRadio({
  checked,
  onSelect,
  label,
  hint,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
  hint: string;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-xl border px-3 py-2 cursor-pointer ${
        checked ? "border-primary bg-primary/5" : "border-gray-200 hover:bg-gray-50"
      }`}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onSelect}
        className="mt-1 accent-primary"
      />
      <span>
        <span className="block text-sm font-medium text-gray-800">{label}</span>
        <span className="block text-xs text-gray-500">{hint}</span>
      </span>
    </label>
  );
}
