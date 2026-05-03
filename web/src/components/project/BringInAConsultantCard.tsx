import { ArrowRight, Crown } from "lucide-react";
import { Link } from "@tanstack/react-router";

interface BringInAConsultantCardProps {
  isPersonalWorkspace: boolean;
  hasConsultant: boolean;
}

/**
 * Non-blocking prompt shown on the project Overview tab when a marketplace
 * project doesn't yet have a consultant assigned.
 *
 * Visibility rules (per specs/platform-foundations/requirements.md):
 *   - hide entirely on personal workspaces (they don't need a consultant)
 *   - hide once a consultant is assigned
 *   - otherwise: show as a discoverable but non-blocking card
 */
export function BringInAConsultantCard({
  isPersonalWorkspace,
  hasConsultant,
}: BringInAConsultantCardProps) {
  if (isPersonalWorkspace || hasConsultant) return null;

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50 to-amber-50/50 p-5 shadow-[0_4px_12px_rgba(245,158,11,0.08)] sm:p-6">
      <div className="flex flex-wrap items-center gap-4 sm:flex-nowrap">
        <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-white text-amber-700">
          <Crown className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-slate-900">
            Ready to bring in a vetted lead?
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            A vetted consultant will scope, price, and assemble your team
            within 48 hours. You stay in the loop — they run delivery.
          </p>
        </div>
        <Link
          to="/dashboard"
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(15,23,42,0.18)] transition-colors hover:bg-slate-800"
        >
          Find a consultant
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
