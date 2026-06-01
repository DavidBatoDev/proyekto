import { Link, useRouterState } from "@tanstack/react-router";
import { useAuthStore } from "@/stores/authStore";
import { getFreelancerStage, getStageMeta } from "@/lib/freelancer-stage";

export function FreelancerSystemStatusLayer() {
  const { profile, isAuthenticated } = useAuthStore();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (!isAuthenticated || !profile || profile.active_persona !== "freelancer") {
    return null;
  }

  const isFreelancerDashboardPage = pathname.startsWith("/dashboard");

  if (!isFreelancerDashboardPage) {
    return null;
  }

  const stage = getFreelancerStage(profile);
  const stageMeta = getStageMeta(stage);
  const profileId = profile.id;

  const actionLink: "/freelancer/go-live" | "/dashboard" =
    stage === "onboarding" ? "/freelancer/go-live" : "/dashboard";

  return (
    <section
      className="mt-14 bg-white border-b border-[#e9eaec]"
      data-system-status="freelancer"
    >
      <div className="max-w-[1440px] mx-auto px-10 py-3 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[#333438]">System Status</p>
          {stage === "matching" ? (
            <p className="text-xs text-[#61636c] truncate">
              Consultants are reviewing your{" "}
              <Link
                to="/profile/$profileId"
                params={{ profileId }}
                className="text-[#ff9933] hover:underline"
              >
                profile
              </Link>{" "}
              for active projects.
            </p>
          ) : (
            <p className="text-xs text-[#61636c] truncate">{stageMeta.systemLine}</p>
          )}
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div className="hidden sm:block w-40">
            <p className="text-[11px] text-[#61636c] mb-1">{stageMeta.label}</p>
            <div className="w-full h-2 bg-[#e9eaec] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${stageMeta.progressPercent}%`, backgroundColor: "var(--secondary)" }}
              />
            </div>
          </div>

          {stage === "matching" ? (
            <Link
              to="/profile/$profileId"
              params={{ profileId }}
              className="text-xs font-semibold px-3 py-1.5 rounded text-white"
              style={{ backgroundColor: "var(--secondary)" }}
            >
              {stageMeta.nextAction}
            </Link>
          ) : (
            <Link
              to={actionLink}
              className="text-xs font-semibold px-3 py-1.5 rounded text-white"
              style={{ backgroundColor: "var(--secondary)" }}
            >
              {stageMeta.nextAction}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
