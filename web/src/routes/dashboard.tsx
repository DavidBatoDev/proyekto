import { createFileRoute, redirect } from "@tanstack/react-router";
import { useAuthStore } from "@/stores/authStore";
import { PrimaryFlow } from "@/components/home/LeftSide";
import { useEffect } from "react";
import { useTutorial } from "@/contexts/TutorialContext";
import { dashboardTutorial } from "@/tutorials/dashboardTutorial";
import { useProfileQuery } from "@/hooks/useProfileQuery";

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
  const { startTutorial, isActive } = useTutorial();
  const isFreelancer = profile?.active_persona === "freelancer";

  // Auto-start tutorial on first visit
  useEffect(() => {
    // Only start tutorial if profile is loaded, tutorial not active, AND onboarding is completed
    if (!profile || isActive || !profile.has_completed_onboarding) return;

    const hasCompletedTutorial = profile.tutorials_completed?.dashboard;
    
    if (!hasCompletedTutorial) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        startTutorial(dashboardTutorial);
      }, 500);
    }
  }, [profile, startTutorial, isActive]);

  return (
    <div className="min-h-screen bg-[#f6f7f8]">
      <div
        className={`max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 pb-8 ${
          isFreelancer ? "pt-6" : "pt-[88px]"
        }`}
      >
        <div data-tutorial="projects-section">
          <PrimaryFlow />
        </div>
      </div>
    </div>
  );
}
