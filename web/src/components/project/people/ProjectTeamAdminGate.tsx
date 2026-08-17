import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { PermissionDeniedBanner } from "@/components/common/PermissionDeniedBanner";
import { useProjectTeamAccess } from "./useProjectTeamAccess";

export function ProjectTeamAdminGate({
	projectId,
	children,
}: {
	projectId: string;
	children: ReactNode;
}) {
	const access = useProjectTeamAccess(projectId);

	if (access.isPending) {
		return (
			<div className="flex justify-center py-16">
				<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (!access.canViewAdmin) {
		return (
			<PermissionDeniedBanner
				parsed={{
					path: "members.manage",
					label: "Manage project members",
					requiredRole: "admin",
					message:
						"Permissions and invitations are available to members who can manage the roster.",
				}}
			/>
		);
	}

	return <>{children}</>;
}
