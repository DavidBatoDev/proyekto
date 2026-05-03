import { Link } from "@tanstack/react-router";
import { Check, Circle, Sparkles } from "lucide-react";
import {
  useFreelancerEligibility,
  type FreelancerRequirement,
} from "@/hooks/useFreelancerEligibility";

interface ChecklistItem {
  key: FreelancerRequirement;
  label: string;
  description: string;
  /** Where the user goes to satisfy this requirement */
  ctaTo: string;
  ctaLabel: string;
}

const ITEMS: ChecklistItem[] = [
  {
    key: "identity",
    label: "Verify your identity",
    description: "Upload a government-issued ID. Required for all freelancers.",
    ctaTo: "/profile",
    ctaLabel: "Add document",
  },
  {
    key: "rate_settings",
    label: "Set your hourly rate",
    description: "Tell clients what you charge and your availability.",
    ctaTo: "/profile",
    ctaLabel: "Set rates",
  },
  {
    key: "portfolio",
    label: "Add a portfolio item",
    description: "At least one piece of work that represents what you do.",
    ctaTo: "/profile",
    ctaLabel: "Add work",
  },
  {
    key: "profile_basics",
    label: "Complete profile basics",
    description: "A headline, a bio, and your country.",
    ctaTo: "/profile",
    ctaLabel: "Edit profile",
  },
];

/**
 * Sidebar widget on the dashboard. Shown when the user is NOT yet
 * freelancer-eligible. Hides itself once all four criteria are satisfied.
 *
 * The dashboard mounts this; it's a pure render based on the hook. No
 * imperative behavior — clicking an item routes the user to the relevant
 * profile section to satisfy it.
 */
export function FreelancerEligibilityChecklist() {
  const { data, isLoading } = useFreelancerEligibility();

  if (isLoading || !data) return null;
  if (data.eligible) return null;

  const completed = ITEMS.length - data.missing.length;

  return (
    <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-700">
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Become a freelancer
          </h3>
          <p className="text-xs text-slate-500">
            {completed} of {ITEMS.length} complete
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {ITEMS.map((item) => {
          const done = !data.missing.includes(item.key);
          return (
            <li
              key={item.key}
              className="flex items-start gap-3 rounded-xl border border-transparent p-2 transition-colors hover:border-slate-200 hover:bg-slate-50"
            >
              {done ? (
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              ) : (
                <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" />
              )}
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-medium ${
                    done ? "text-slate-500 line-through" : "text-slate-900"
                  }`}
                >
                  {item.label}
                </p>
                {!done && (
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                    {item.description}
                  </p>
                )}
                {!done && (
                  <Link
                    to={item.ctaTo}
                    className="mt-1 inline-block text-xs font-semibold text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-slate-900 hover:decoration-slate-700"
                  >
                    {item.ctaLabel} →
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
