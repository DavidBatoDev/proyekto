import { useAuthStore } from "@/stores/authStore";

type Persona = "client" | "freelancer" | "consultant" | "admin";

const clientSteps = [
  "Post your project vision",
  "Get matched with consultants",
  "Receive your roadmap",
  "Start execution",
];

const freelancerSteps = [
  "Complete your profile",
  "Get matched to projects",
  "Collaborate with consultants",
  "Deliver milestones",
];

export function HowItWorksPanel() {
  const { profile } = useAuthStore();
  const persona = (profile?.active_persona || "client") as Persona;
  const steps = persona === "freelancer" ? freelancerSteps : clientSteps;

  return (
    <section className="bg-white rounded-xl shadow-sm p-6" data-tutorial="dashboard-how-it-works">
      <h2 className="text-[20px] font-semibold text-[#333438] mb-1">How It Works</h2>
      <p className="text-sm text-[#61636c] mb-4">
        {persona === "freelancer"
          ? "Your path from activation to milestone delivery."
          : "Your path from vision to guided execution."}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {steps.map((step, index) => (
          <div key={step} className="flex items-start gap-3 rounded-lg bg-muted px-3 py-2">
            <span className="text-xs font-semibold text-white rounded-full w-5 h-5 inline-flex items-center justify-center mt-0.5" style={{ backgroundColor: "var(--secondary)" }}>
              {index + 1}
            </span>
            <p className="text-sm font-medium text-[#333438]">{step}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
