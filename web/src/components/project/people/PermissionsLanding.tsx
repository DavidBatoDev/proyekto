import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { AppSectionHeader } from "@/components/common/AppPrimitives";
import { useUser } from "@/stores/authStore";
import { PersonRow, primaryTeamFor, teamOriginFor } from "./PersonRow";
import { type PersonAccess, useProjectPeople } from "./useProjectPeople";

/** Role baselines are fixed; this page edits only per-member overrides. */
export function PermissionsLanding({ projectId }: { projectId: string }) {
	const user = useUser();
	const people = useProjectPeople(projectId, user?.id ?? null);
	const navigate = useNavigate();

	const openMember = (person: PersonAccess) =>
		void navigate({
			to: "/project/$projectId/team/permissions",
			params: { projectId },
			search: { memberId: person.memberId },
		});

	if (people.isPending) {
		return (
			<div className="flex justify-center py-16">
				<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<AppSectionHeader
				kicker="Team"
				title="Permissions"
				subtitle="Review or override access for one project member."
			/>

			{people.people.length > 0 && (
				<section className="overflow-hidden rounded-2xl border border-border bg-card">
					<div className="border-b border-border bg-muted/40 px-4 py-2.5">
						<p className="text-sm font-semibold text-foreground">By member</p>
						<p className="text-[11px] text-muted-foreground">
							Custom overrides layer on top of that person's fixed role and
							origin baseline.
						</p>
					</div>
					<div className="divide-y divide-border">
						{people.people.map((person) => (
							<PersonRow
								key={person.key}
								person={person}
								badgeTeam={primaryTeamFor(person, people.teamById)}
								origin={teamOriginFor(person, people.teamById)}
								onOpen={openMember}
							/>
						))}
					</div>
				</section>
			)}
		</div>
	);
}
