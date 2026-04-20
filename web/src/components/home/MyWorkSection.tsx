import { useAuthStore } from "@/stores/authStore";
import { getFreelancerStage } from "@/lib/freelancer-stage";

type WorkItem = {
  id: string;
  title: string;
  type: "Task" | "Milestone";
  dueLabel: string;
};

export function MyWorkSection() {
  const { profile } = useAuthStore();
  const persona = profile?.active_persona || "client";

  if (persona !== "freelancer") return null;

  const items: WorkItem[] = [];
  const stage = getFreelancerStage(profile, { hasAssignedWork: items.length > 0 });
  const topFocus =
    stage === "active-work"
      ? "Complete the highest-priority milestone task before your next check-in."
      : stage === "assigned"
        ? "Review your assigned roadmap and confirm your first execution task."
        : stage === "matching"
          ? "Stay match-ready: refine your headline, core skills, and availability."
          : "Complete activation details to unlock matching and daily work.";

  return (
    <section
      className="app-surface-card app-slide-up p-6"
      data-tutorial="freelancer-my-work-section"
    >
      <div className="mb-3">
        <h2 className="text-[20px] font-semibold tracking-tight text-slate-900">
          My Work
        </h2>
        <p className="text-xs text-slate-600">
          Assigned execution tasks and milestone responsibilities
        </p>
      </div>

      <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="mb-1 text-xs font-semibold text-slate-600">TODAY'S FOCUS</p>
        <p className="text-sm font-semibold text-slate-900">{topFocus}</p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="mb-1 text-sm font-semibold text-slate-900">
            Your first assignment is in motion
          </p>
          <p className="text-xs text-slate-600">
            Consultant matching is currently staffing roadmap roles. As soon as you are placed, tasks and milestone responsibilities appear here in real time.
          </p>
          <p className="mt-2 text-[11px] text-slate-600">Matching in progress...</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-left"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">{item.title}</p>
                <p className="text-xs text-slate-600">{item.type}</p>
              </div>
              <span className="text-[11px] text-slate-600">{item.dueLabel}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
