import { Link } from "@tanstack/react-router";
import { ArrowRight, Crown } from "lucide-react";

interface BringInAConsultantCardProps {
	isPersonalWorkspace: boolean;
	memberCount: number;
}

/**
 * Non-blocking prompt shown on the project Overview tab, pointing at the
 * marketplace: a discoverable CTA for someone running a project on their own.
 *
 * Visibility rules:
 *   - hide entirely on personal workspaces (they are not delivery projects)
 *   - hide once anybody else is on the project
 *   - otherwise: show as a discoverable but non-blocking card
 *
 * The second rule used to be "hide once a consultant is assigned", asking the
 * execution layer which member row carried origin 'consultant'. A project has
 * members, not a consultant, so the card now keys off whether the owner is
 * still working alone — which is the thing it was really asking.
 */
export function BringInAConsultantCard({
	isPersonalWorkspace,
	memberCount,
}: BringInAConsultantCardProps) {
	if (isPersonalWorkspace || memberCount > 1) return null;

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
						A vetted consultant will scope, price, and assemble your team within
						48 hours. You stay in the loop — they run delivery.
					</p>
				</div>
				<Link
					to="/dashboard"
					className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(15,23,42,0.18)] transition-colors hover:bg-primary/90"
				>
					Find a consultant
					<ArrowRight className="h-4 w-4" />
				</Link>
			</div>
		</div>
	);
}
