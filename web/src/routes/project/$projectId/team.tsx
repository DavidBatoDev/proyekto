import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PeoplePage } from "@/components/project/people/PeoplePage";
import { PermissionCatalogDialog } from "@/components/project/people/PermissionCatalogDialog";
import { PersonAccessDrawer } from "@/components/project/people/PersonAccessDrawer";
import { ProjectPermissionsEditor } from "@/components/project/people/ProjectPermissions";
import { useProjectPeople } from "@/components/project/people/useProjectPeople";
import { useUser } from "@/stores/authStore";

/**
 * The project's single people surface.
 *
 * People management used to be spread over four pages and then four tabs,
 * which between them rendered the member list five times with three different
 * notions of "role". It is one roster now: teams are collapsible groups inside
 * it, and a person's access opens a drawer rather than replacing the page.
 *
 * Search params:
 *   `?memberId=` opens the access drawer over the roster (deep-linkable).
 *   `?matrix=`   opens the full permission-by-permission editor for a member.
 *   `?role=`     opens that editor for a role template.
 *   `?tab=`      accepted and discarded — old bookmarks land on the roster
 *                instead of rendering a tab that no longer exists.
 */

export const Route = createFileRoute("/project/$projectId/team")({
	validateSearch: (
		search: Record<string, unknown>,
	): {
		memberId?: string;
		matrix?: string;
		role?: string;
	} => ({
		memberId: (search.memberId as string) || undefined,
		matrix: (search.matrix as string) || undefined,
		role: (search.role as string) || undefined,
	}),
	component: RouteComponent,
});

function RouteComponent() {
	const { projectId } = Route.useParams();
	const { memberId, matrix, role } = Route.useSearch();
	const navigate = useNavigate();
	const user = useUser();
	const [catalogOpen, setCatalogOpen] = useState(false);

	// The per-permission matrix is a genuine drill-down: it has its own unsaved
	// -changes bar and needs the room, so it replaces the page.
	if (matrix || role) {
		return (
			<Shell>
				<ProjectPermissionsEditor
					projectId={projectId}
					memberId={matrix}
					role={role}
				/>
			</Shell>
		);
	}

	return (
		<Shell>
			<PeoplePage
				projectId={projectId}
				onOpenPerson={(person) =>
					void navigate({
						to: "/project/$projectId/team",
						params: { projectId },
						search: { memberId: person.memberId },
						replace: true,
					})
				}
				onOpenCatalog={() => setCatalogOpen(true)}
			/>
			{memberId && (
				<DrawerForMember
					projectId={projectId}
					memberId={memberId}
					callerUserId={user?.id ?? null}
					onClose={() =>
						void navigate({
							to: "/project/$projectId/team",
							params: { projectId },
							search: {},
							replace: true,
						})
					}
				/>
			)}
			{catalogOpen && (
				<PermissionCatalogDialog onClose={() => setCatalogOpen(false)} />
			)}
		</Shell>
	);
}

/**
 * Resolves `?memberId=` against the roster so the drawer is deep-linkable.
 *
 * Kept separate so the lookup re-runs on its own rather than forcing the whole
 * page to re-render, and so a stale link (member since removed) closes itself
 * instead of rendering an empty drawer.
 */
function DrawerForMember({
	projectId,
	memberId,
	callerUserId,
	onClose,
}: {
	projectId: string;
	memberId: string;
	callerUserId: string | null;
	onClose: () => void;
}) {
	const { people, isPending } = useProjectPeople(projectId, callerUserId);
	const person = useMemo(
		() => people.find((p) => p.memberId === memberId) ?? null,
		[people, memberId],
	);

	if (isPending) return null;
	if (!person) return null;

	return (
		<PersonAccessDrawer
			projectId={projectId}
			person={person}
			onClose={onClose}
		/>
	);
}

function Shell({ children }: { children: React.ReactNode }) {
	return (
		<div className="app-shell-bg h-full w-full overflow-y-auto">
			<div className="mx-auto w-full max-w-5xl px-5 py-6 md:px-8 md:py-8">
				{children}
			</div>
		</div>
	);
}
