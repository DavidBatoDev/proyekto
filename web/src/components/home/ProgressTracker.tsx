import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { getFreelancerStage } from "@/lib/freelancer-stage";

type TrackerStatus = "completed" | "current" | "upcoming";

type TrackerItem = {
  id: string;
  title: string;
  description: string;
  href: string;
  status: TrackerStatus;
};

function statusSymbol(status: TrackerStatus): string {
  if (status === "completed") return "✔";
  if (status === "current") return "→";
  return "○";
}

export function ProgressTracker() {
  const { profile } = useAuthStore();
  const stage = getFreelancerStage(profile);
  const [isMinimized, setIsMinimized] = useState(false);

  const items: TrackerItem[] = [
    {
      id: "activation",
      title: "Complete activation",
      description: "Make your profile visible to consultants.",
      href: "/freelancer/go-live",
      status: stage === "onboarding" ? "current" : "completed",
    },
    {
      id: "matching",
      title: "Get matched to a project",
      description: "Consultants shortlist freelancers based on roadmap needs.",
      href: "/dashboard",
      status: stage === "matching" ? "current" : stage === "assigned" || stage === "active-work" ? "completed" : "upcoming",
    },
    {
      id: "roadmap",
      title: "Review your roadmap",
      description: "Open your milestone roadmap once assignment is confirmed.",
      href: "/dashboard",
      status: stage === "assigned" ? "current" : stage === "active-work" ? "completed" : "upcoming",
    },
    {
      id: "delivery",
      title: "Deliver assigned work",
      description: "Execute tasks and update milestones.",
      href: "/dashboard",
      status: stage === "active-work" ? "current" : "upcoming",
    },
  ];

  const completed = items.filter((item) => item.status === "completed").length;
  const currentItem = items.find((item) => item.status === "current") ?? items[0];

  return (
    <section
      className="bg-white rounded-xl shadow-sm p-4 sticky top-[92px] z-10"
      data-tutorial="dashboard-progress-tracker"
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-[#333438]">Progress Tracker</p>
          <p className="text-xs text-[#61636c]">{completed}/{items.length} completed</p>
        </div>
        <button
          type="button"
          className="text-xs font-semibold"
          style={{ color: "var(--secondary)" }}
          onClick={() => setIsMinimized((value) => !value)}
        >
          {isMinimized ? "Expand" : "Minimize"}
        </button>
      </div>

      {isMinimized ? (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-muted p-3">
          <p className="text-xs text-[#61636c]">Current</p>
          <p className="text-sm font-semibold text-[#333438] truncate">{currentItem.title}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#333438] flex items-center gap-2">
                  <span className="text-[#61636c]">{statusSymbol(item.status)}</span>
                  <span className="truncate">{item.title}</span>
                </p>
                <p className="text-xs text-[#61636c]">{item.description}</p>
              </div>
              {item.status === "current" ? (
                <Link
                  to={item.href}
                  className="text-xs font-semibold px-3 py-1.5 rounded text-white whitespace-nowrap"
                  style={{ backgroundColor: "var(--secondary)" }}
                >
                  Continue
                </Link>
              ) : (
                <span className="text-[11px] text-[#61636c] whitespace-nowrap">
                  {item.status === "completed" ? "Completed" : "Upcoming"}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
