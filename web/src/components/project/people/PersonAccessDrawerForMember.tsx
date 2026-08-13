import { useMemo } from "react";
import { PersonAccessDrawer } from "./PersonAccessDrawer";
import { useProjectPeople } from "./useProjectPeople";

/**
 * Resolves `?memberId=` against the roster so the drawer is deep-linkable.
 *
 * Kept separate so the lookup re-runs on its own rather than forcing the whole
 * page to re-render, and so a stale link (member since removed) closes itself
 * instead of rendering an empty drawer. Shared by every team/* route that
 * opens the drawer over its own content.
 */
export function PersonAccessDrawerForMember({
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
