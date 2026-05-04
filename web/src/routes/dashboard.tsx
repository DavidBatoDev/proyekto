import { createFileRoute, redirect } from "@tanstack/react-router";
import { useAuthStore } from "@/stores/authStore";
import { PrimaryFlow } from "@/components/home/LeftSide";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { FreelancerEligibilityChecklist } from "@/components/profile/FreelancerEligibilityChecklist";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: () => {
    const { isAuthenticated } = useAuthStore.getState();

    // Only check authentication here
    if (!isAuthenticated) {
      throw redirect({
        to: "/auth/login",
      });
    }
  },
  component: DashboardPage,
});

function DashboardPage() {
  const { profile } = useAuthStore();
  useProfileQuery();
  const isFreelancer = profile?.active_persona === "freelancer";

  return (
    <div className="min-h-screen app-shell-bg">
      <div
        className={`max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 pb-10 app-slide-up ${
          isFreelancer ? "pt-6" : "pt-[88px]"
        }`}
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div data-tutorial="projects-section">
            <PrimaryFlow />
          </div>
          <FreelancerEligibilityChecklist />
        </div>
      </div>
    </div>
  );
}
