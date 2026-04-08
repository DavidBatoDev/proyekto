import { createFileRoute } from "@tanstack/react-router";
import { CreditCard } from "lucide-react";
import {
  AppEmptyState,
  AppSectionHeader,
  AppSurfaceCard,
} from "@/components/common/AppPrimitives";

export const Route = createFileRoute("/project/$projectId/payments")({
  component: PaymentsPage,
});

function PaymentsPage() {
  return (
    <div className="app-shell-bg h-full w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-5 py-6 md:px-8 md:py-8">
        <AppSurfaceCard strong className="mb-6 p-6">
          <AppSectionHeader
            kicker="Finance"
            title="Payments"
            subtitle="Track and manage all payments for this project."
            rightSlot={
              <button
                disabled
                className="app-cta rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                + Add Payment
              </button>
            }
          />
        </AppSurfaceCard>

        <AppEmptyState
          icon={CreditCard}
          title="No payments yet"
          description="Add payments to track invoices, milestones, and billing for this project."
          className="app-surface-card-strong border-dashed py-16"
        />
      </div>
    </div>
  );
}
