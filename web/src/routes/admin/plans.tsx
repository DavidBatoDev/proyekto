import { createFileRoute } from "@tanstack/react-router";
import { PlanLimitsEditor } from "@/components/admin/plans/PlanLimitsEditor";

export const Route = createFileRoute("/admin/plans")({
	component: PlanLimitsEditor,
});
