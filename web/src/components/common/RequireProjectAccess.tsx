import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useProjectMyPermissionsQuery } from "@/hooks/useProjectQueries";
import type { ProjectPermissions } from "@/services/project.service";
import { PermissionDeniedBanner } from "./PermissionDeniedBanner";
import {
	getPermissionLabel,
	type ParsedPermissionError,
} from "@/lib/permissionErrors";

type AccessGate = keyof ProjectPermissions["access"];

/**
 * Frontend gate for project route bodies. Loads the caller's resolved
 * permissions for `projectId` and renders one of:
 *   - skeleton while loading
 *   - <PermissionDeniedBanner /> when the access flag is false
 *   - <PermissionDeniedBanner /> when the permissions query itself 403s
 *   - children when access is granted
 *
 * Use this on `/roadmap`, `/work-items`, `/chat`, `/resources`, `/team`
 * etc. so the user gets an immediate, structured "you need X" message
 * instead of a generic blank or red error card.
 */
export function RequireProjectAccess({
	projectId,
	access,
	children,
	loadingFallback,
	className = "",
}: {
	projectId: string;
	access: AccessGate;
	children: ReactNode;
	loadingFallback?: ReactNode;
	className?: string;
}) {
	const { data, isPending, error } = useProjectMyPermissionsQuery(projectId);

	if (isPending) {
		return (
			loadingFallback ?? (
				<div className="flex h-full items-center justify-center p-12">
					<Loader2 className="h-6 w-6 animate-spin text-slate-400" />
				</div>
			)
		);
	}

	// If the permissions query itself failed (403/missing_permission), show
	// the banner with whatever the server told us.
	if (error) {
		return (
			<div className={`p-6 ${className}`}>
				<PermissionDeniedBanner error={error} />
			</div>
		);
	}

	if (!data || data.access[access] !== true) {
		const path = `access.${access}`;
		const parsed: ParsedPermissionError = {
			path,
			label: getPermissionLabel(path),
			requiredRole: null,
			message: `You don't have access to this section of the project.`,
		};
		return (
			<div className={`p-6 ${className}`}>
				<PermissionDeniedBanner parsed={parsed} />
			</div>
		);
	}

	return <>{children}</>;
}
