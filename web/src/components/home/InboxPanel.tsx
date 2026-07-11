import { useAuthStore } from "@/stores/authStore";

type InboxItem = {
  id: string;
  type: "Notification" | "Update" | "Assignment" | "Reminder";
  title: string;
  timestamp: string;
  actionLabel: string;
};

export function InboxPanel() {
  const { profile } = useAuthStore();
  const persona = profile?.active_persona || "client";

  if (persona !== "freelancer") return null;

  const isActivated = Boolean(profile?.has_completed_onboarding);
  const items: InboxItem[] = isActivated
    ? [
        {
          id: "inbox-1",
          type: "Update",
          title: "You're now visible to consultants reviewing active projects",
          timestamp: "2h ago",
          actionLabel: "View matches",
        },
        {
          id: "inbox-2",
          type: "Reminder",
          title: "Your profile is in review cycles. Keep headline and skills fresh to improve match speed",
          timestamp: "5h ago",
          actionLabel: "Update profile",
        },
        {
          id: "inbox-4",
          type: "Notification",
          title: "New opportunities are opening soon as consultant shortlists update",
          timestamp: "just now",
          actionLabel: "Open dashboard",
        },
      ]
    : [
        {
          id: "inbox-3",
          type: "Reminder",
          title: "Complete activation to enter matching and unlock your first project opportunities",
          timestamp: "just now",
          actionLabel: "Complete activation",
        },
      ];

  return (
    <section className="bg-white rounded-xl shadow-sm p-6" data-tutorial="freelancer-inbox-section">
      <div className="mb-3">
        <h3 className="text-[20px] font-semibold text-black">INBOX</h3>
        <p className="text-xs text-[#61636c]">Notifications, updates, assignments, and reminders</p>
      </div>

      <div className="space-y-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => console.info("Inbox item clicked:", item.id)}
            className="w-full rounded-lg bg-muted p-3 text-left transition-colors hover:bg-accent"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold text-[#61636c] mb-0.5">{item.type}</p>
                <p className="text-sm text-[#333438]">{item.title}</p>
                <button
                  type="button"
                  className="text-[11px] font-semibold mt-2"
                  style={{ color: "var(--secondary)" }}
                  onClick={(event) => {
                    event.stopPropagation();
                    console.info("Inbox action clicked:", item.actionLabel);
                  }}
                >
                  {item.actionLabel} →
                </button>
              </div>
              <span className="text-[11px] text-[#92969f] whitespace-nowrap">{item.timestamp}</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
