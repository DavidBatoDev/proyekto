import { createFileRoute, redirect } from "@tanstack/react-router";
import { useAuthStore } from "@/stores/authStore";
import { PrimaryFlow } from "@/components/home/LeftSide";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { DashboardShell } from "@/components/layout/DashboardShell";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: () => {
    const { isAuthenticated } = useAuthStore.getState();
    if (!isAuthenticated) {
      throw redirect({ to: "/auth/login" });
    }
  },
  component: DashboardPage,
});

function DashboardPage() {
  useProfileQuery();
  return (
    <DashboardShell>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-10 app-slide-up">
        <PrimaryFlow />
      </div>
    </DashboardShell>
  );
}
