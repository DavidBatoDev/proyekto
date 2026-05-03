import { ArrowRight, BriefcaseBusiness, Crown } from "lucide-react";
import type { OnboardingLane } from "../../../lib/auth-api";

interface SignupStepLaneProps {
  lane: OnboardingLane;
  setLane: (lane: OnboardingLane) => void;
  onNext: () => void;
}

/**
 * Step 1: Lane picker.
 *
 * Shown to every new signup, even those routed from the homepage CTAs (the URL
 * `?lane=` param pre-selects the right card so the user only has to click
 * Continue). Lane choice drives the entire downstream experience — see
 * `SignupForm` for how it's persisted and how it routes post-verify.
 */
export function SignupStepLane({ lane, setLane, onNext }: SignupStepLaneProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
          How will you use Proyekto?
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Pick the lane that fits — you can always change context later.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <LaneCard
          label="I'm a client or freelancer"
          description="Plan a project, hire a vetted team, or get matched to client work."
          icon={BriefcaseBusiness}
          tone="primary"
          selected={lane === "client_freelancer"}
          onClick={() => setLane("client_freelancer")}
        />
        <LaneCard
          label="I'm applying as a consultant"
          description="Run client engagements like a firm. Lead vetted teams on Proyekto."
          icon={Crown}
          tone="amber"
          selected={lane === "consultant"}
          onClick={() => setLane("consultant")}
        />
      </div>

      <button
        type="button"
        onClick={onNext}
        className="mt-2 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-slate-900 px-6 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.26)] transition-colors hover:bg-slate-800"
      >
        Continue
        <ArrowRight className="h-4 w-4" />
      </button>

      <p className="text-center text-xs text-slate-500">
        Already have an account?{" "}
        <a
          href="/auth/login"
          className="font-semibold text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-slate-900 hover:decoration-slate-700"
        >
          Log in
        </a>
      </p>
    </div>
  );
}

interface LaneCardProps {
  label: string;
  description: string;
  icon: typeof BriefcaseBusiness;
  tone: "primary" | "amber";
  selected: boolean;
  onClick: () => void;
}

function LaneCard({
  label,
  description,
  icon: Icon,
  tone,
  selected,
  onClick,
}: LaneCardProps) {
  const accent =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-blue-200 bg-blue-50 text-blue-700";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`group relative flex flex-col items-start gap-3 rounded-2xl border p-5 text-left transition-all ${
        selected
          ? "border-slate-900 bg-white shadow-[0_12px_24px_rgba(15,23,42,0.12)]"
          : "border-slate-200 bg-white hover:border-slate-400 hover:shadow-[0_8px_18px_rgba(15,23,42,0.08)]"
      }`}
    >
      {/* Selected radio indicator */}
      <span
        className={`absolute right-4 top-4 inline-flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors ${
          selected ? "border-slate-900 bg-slate-900" : "border-slate-300 bg-white"
        }`}
      >
        {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>

      <span
        className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border ${accent}`}
      >
        <Icon className="h-5 w-5" />
      </span>

      <div className="pr-8">
        <h3 className="text-base font-semibold text-slate-900">{label}</h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          {description}
        </p>
      </div>
    </button>
  );
}
