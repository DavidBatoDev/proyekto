import { Link } from "@tanstack/react-router";
import { useAuthStore } from "@/stores/authStore";

type Persona = "client" | "freelancer" | "consultant" | "admin";

type ChecklistItem = {
  id: string;
  title: string;
  description: string;
  href: string;
  done: boolean;
};

function getChecklist(persona: Persona, hasCompletedOnboarding: boolean): ChecklistItem[] {
  if (persona === "freelancer") {
    return [
      {
        id: "onboarding",
        title: "Finish onboarding",
        description: "Tell us how you want to work so we can tailor your dashboard.",
        href: "/onboarding",
        done: hasCompletedOnboarding,
      },
      {
        id: "go-live",
        title: "Complete activation",
        description: "Make your profile visible to consultants and clients.",
        href: "/freelancer/go-live",
        done: false,
      },
      {
        id: "marketplace",
        title: "Explore marketplace",
        description: "See active opportunities and consultant-led projects.",
        href: "/marketplace",
        done: false,
      },
    ];
  }

  return [
    {
      id: "onboarding",
      title: "Finish onboarding",
      description: "Set your working preferences and start with the right tools.",
      href: "/onboarding",
      done: hasCompletedOnboarding,
    },
    {
      id: "post-project",
      title: "Post your first project",
      description: "Create a project brief so consultants can help architect your roadmap.",
      href: "/project-posting",
      done: false,
    },
    {
      id: "browse-consultants",
      title: "Browse consultants",
      description: "Find expert consultants to refine scope and delivery milestones.",
      href: "/marketplace",
      done: false,
    },
  ];
}

export function GetStartedPanel() {
  const { profile } = useAuthStore();
  const persona = (profile?.active_persona || "client") as Persona;
  const checklist = getChecklist(persona, Boolean(profile?.has_completed_onboarding));
  const primaryNextStep = checklist.find((item) => !item.done) ?? null;

  return (
    <section className="bg-white rounded-xl shadow-sm p-6" data-tutorial="dashboard-get-started">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[20px] font-semibold text-[#333438]">Get Started</h2>
        <span className="text-xs text-[#92969f]">
          {checklist.filter((item) => item.done).length}/{checklist.length} completed
        </span>
      </div>

      <div className="space-y-3">
        {checklist.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3">
            <div>
              <p className="text-sm font-semibold text-[#333438]">{item.title}</p>
              <p className="text-xs text-[#61636c]">{item.description}</p>
            </div>
            {item.done ? (
              <span className="text-xs font-semibold px-2 py-1 rounded bg-emerald-100 text-emerald-700">
                Done
              </span>
            ) : primaryNextStep?.id === item.id ? (
              <Link
                to={item.href}
                className="text-xs font-semibold px-3 py-1.5 rounded text-white"
                style={{ backgroundColor: "var(--secondary)" }}
              >
                Continue
              </Link>
            ) : (
              <span className="text-xs font-semibold px-2 py-1 rounded bg-gray-200 text-gray-700">
                Up next
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
