import { Link } from "@tanstack/react-router";
import { useAuthStore } from "@/stores/authStore";
import { getFreelancerStage } from "@/lib/freelancer-stage";

type TodayTask = {
  id: string;
  title: string;
  priority: "High" | "Medium" | "Low";
};

type PotentialMatch = {
  id: string;
  project: string;
  stage: string;
  fit: string;
};

function formatTodayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function FreelancerTodaySection() {
  const { profile } = useAuthStore();
  const persona = profile?.active_persona || "client";

  if (persona !== "freelancer") return null;

  const isActivated = Boolean(profile?.has_completed_onboarding);
  const todayTasks: TodayTask[] = [];
  const stage = getFreelancerStage(profile, { hasAssignedWork: todayTasks.length > 0 });
  const potentialMatches: PotentialMatch[] = [
    {
      id: "pm-1",
      project: "Creator Marketplace Revamp",
      stage: "Consultant shortlisting",
      fit: "High fit: Product UX + SaaS",
    },
    {
      id: "pm-2",
      project: "B2B Analytics Dashboard",
      stage: "Scope alignment",
      fit: "Strong fit: Interaction design",
    },
    {
      id: "pm-3",
      project: "Mobile Onboarding Optimization",
      stage: "Matching queue",
      fit: "Potential fit: Growth UX",
    },
  ];

  return (
    <section className="bg-white rounded-xl shadow-sm p-6" data-tutorial="freelancer-today-section">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[20px] font-semibold text-[#333438]">Today</h2>
        <span className="text-xs text-[#92969f]">{formatTodayLabel(new Date())}</span>
      </div>

      <div className="mb-4">
        <span
          className={`text-xs font-semibold px-2 py-1 rounded ${
            stage === "active-work" || stage === "assigned" || stage === "matching"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-amber-100 text-amber-700"
          }`}
        >
          {stage === "onboarding"
            ? "System Status: Activation required"
            : stage === "matching"
              ? "System Status: Matching in progress"
              : stage === "assigned"
                ? "System Status: Assignment confirmed"
                : "System Status: Active delivery"}
        </span>
      </div>

      <div className="mb-4 flex items-center justify-between gap-4 rounded-lg bg-muted p-4">
        <div>
          <p className="text-sm font-semibold text-[#333438] mb-1">
            {stage === "onboarding"
              ? "You're one step from matching. Complete activation to enter consultant reviews."
              : stage === "matching"
                ? "You're in the matching phase. Consultants are actively reviewing your profile."
                : stage === "assigned"
                  ? "You're assigned to a project pipeline. Your execution workspace is finalizing."
                  : "You are in active delivery. Focus on priority tasks and milestone deadlines."}
          </p>
          <p className="text-xs text-[#61636c]">
            {stage === "onboarding"
              ? "Activation unlocks visibility to consultants currently staffing roadmap-driven projects."
              : stage === "matching"
                ? "Profiles being reviewed. New opportunities are opening as projects move into staffing."
                : stage === "assigned"
                  ? "Next system step: roadmap access and first task assignment are being prepared."
                  : "Milestone tracking is active and your next execution updates will appear here."}
          </p>
          <p className="text-[11px] text-[#61636c] mt-2">
            {stage === "onboarding"
              ? "Activation in progress..."
              : stage === "matching"
                ? "Matching in progress..."
                : stage === "assigned"
                  ? "Workspace setup in progress..."
                  : "Delivery in progress..."}
          </p>
        </div>
        <Link
          to="/freelancer/go-live"
          className="text-xs font-semibold px-3 py-1.5 rounded text-white whitespace-nowrap"
          style={{ backgroundColor: "var(--secondary)" }}
        >
          {stage === "onboarding" ? "Complete Activation" : "Review Activation"}
        </Link>
      </div>

      {todayTasks.length === 0 ? (
        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm font-semibold text-[#333438] mb-1">Your work queue is warming up</p>
          <p className="text-xs text-[#61636c]">
            {isActivated
              ? "You are being considered for active roadmap roles. As soon as you are assigned, today's tasks will populate automatically."
              : "Finish activation to start matching. Once visible, this section updates with daily assignments and milestone actions."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {todayTasks.map((task) => (
            <div key={task.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted p-3">
              <p className="text-sm font-medium text-[#333438]">{task.title}</p>
              <span className="text-[11px] font-semibold text-[#61636c]">{task.priority}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-[#333438]">Potential Matches</h3>
          <span className="text-[11px] text-[#61636c]">Updated recently</span>
        </div>
        <div className="space-y-2">
          {potentialMatches.map((match) => (
            <button
              key={match.id}
              type="button"
              className="w-full rounded-lg bg-muted p-3 text-left transition-colors hover:bg-accent"
            >
              <p className="text-sm font-semibold text-[#333438]">{match.project}</p>
              <p className="text-xs text-[#61636c]">{match.stage}</p>
              <p className="text-[11px] text-[#61636c] mt-1">{match.fit}</p>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
