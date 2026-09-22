import { createFileRoute } from "@tanstack/react-router";
import { AdminWorkspacesPage } from "@/components/admin/workspaces/AdminWorkspacesPage";

export const Route = createFileRoute("/admin/workspaces")({
	component: AdminWorkspacesPage,
});
