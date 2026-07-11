import { useAuthStore } from "@/stores/authStore";

type Persona = "client" | "freelancer" | "consultant" | "admin";

type StepStatus = "completed" | "current" | "upcoming";

const clientSteps = [
  "Post your project vision",
  "Get matched with consultants",
  "Receive your roadmap",
  "Start execution",
];

const freelancerSteps = [
  "Complete activation",
  "Get matched to a project",
  "Join the milestone plan",
  "Deliver assigned work",
];

export function HeroStepFlow() {
  const { profile } = useAuthStore();
  const persona = (profile?.active_persona || "client") as Persona;
  const steps = persona === "freelancer" ? freelancerSteps : clientSteps;
  const hasCompletedOnboarding = Boolean(profile?.has_completed_onboarding);

  const currentStepIndex = persona === "freelancer"
    ? hasCompletedOnboarding
      ? 1
      : 0
    : hasCompletedOnboarding
      ? 1
      : 0;

  const getStatus = (index: number): StepStatus => {
    if (index < currentStepIndex) return "completed";
    if (index === currentStepIndex) return "current";
    return "upcoming";
  };

  const currentStageLabel = steps[currentStepIndex] ?? steps[0];

  return (
    <section className="bg-white rounded-xl shadow-sm p-6" data-tutorial="dashboard-hero-steps">
      <div className="mb-3">
        <p className="text-sm font-semibold text-[#333438]">Your next 4 steps</p>
        <p className="text-xs text-[#61636c] mt-1">
          Current stage: <span className="font-semibold text-[#333438]">{currentStageLabel}</span>
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {steps.map((step, index) => (
          <div
            key={step}
            className="flex items-start gap-3 rounded-lg bg-muted px-3 py-2"
          >
            <span className="text-sm font-semibold text-[#61636c] w-4">
              {getStatus(index) === "completed" ? "✔" : getStatus(index) === "current" ? "→" : "○"}
            </span>
            <span
              className="text-xs font-semibold text-white rounded-full w-5 h-5 inline-flex items-center justify-center mt-0.5"
              style={{ backgroundColor: "var(--secondary)" }}
            >
              {index + 1}
            </span>
            <div>
              <p className="text-sm font-medium text-[#333438]">{step}</p>
              <p className="text-[11px] text-[#61636c]">
                {getStatus(index) === "completed"
                  ? "Completed"
                  : getStatus(index) === "current"
                    ? "Current step"
                    : "Upcoming"}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
