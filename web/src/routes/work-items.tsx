import { createFileRoute, redirect } from "@tanstack/react-router";
import { ListChecks } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { DashboardShell } from "@/components/layout/DashboardShell";

export const Route = createFileRoute("/work-items")({
  beforeLoad: () => {
    const { isAuthenticated } = useAuthStore.getState();
    if (!isAuthenticated) {
      throw redirect({ to: "/auth/login" });
    }
  },
  component: WorkItemsPage,
});

function WorkItemsPage() {
  return (
    <DashboardShell>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-10">
        <div className="rounded-2xl border border-slate-200 bg-white px-8 py-14 text-center shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50">
            <ListChecks className="h-6 w-6 text-slate-700" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Your work items, all in one place
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
            A unified view of your tasks across every project is on the way.
          </p>
        </div>
      </div>
    </DashboardShell>
  );
}
