import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceMembersPanel } from "@/components/workspace/settings/WorkspaceMembersPanel";

export const Route = createFileRoute("/workspace/settings/members")({
	component: WorkspaceMembersPanel,
});
