import type { Team, TeamMember } from "@/services/teams.service";
import { TeamAvatarField } from "./TeamAvatarField";
import { TeamDescriptionSection } from "./TeamDescriptionSection";
import { TeamPropertiesPanel } from "./TeamPropertiesPanel";
import { TeamResourcesSection } from "./TeamResourcesSection";
import { TeamTitleField } from "./TeamTitleField";

/**
 * The team's landing surface: who this team is, and what it works out of.
 *
 * The identity block lives inside the tab rather than in the page header on
 * purpose — hoisting it would put an editable title above the Projects and
 * Members tabs too, which is exactly the "edit the team from anywhere" sprawl
 * this page replaces.
 */
export function TeamOverviewTab({
	team,
	members,
	projectCount,
	canEdit,
}: {
	team: Team;
	members: TeamMember[];
	projectCount: number;
	canEdit: boolean;
}) {
	return (
		<div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-8">
			<div className="flex min-w-0 flex-col gap-6">
				<div className="flex items-start gap-4">
					<TeamAvatarField team={team} canEdit={canEdit} />
					<div className="min-w-0 flex-1 pt-1">
						<TeamTitleField
							teamId={team.id}
							name={team.name}
							canEdit={canEdit}
						/>
					</div>
				</div>

				<TeamDescriptionSection
					teamId={team.id}
					description={team.description}
					canEdit={canEdit}
				/>

				<TeamResourcesSection teamId={team.id} canEdit={canEdit} />
			</div>

			<TeamPropertiesPanel
				team={team}
				members={members}
				projectCount={projectCount}
				canEdit={canEdit}
			/>
		</div>
	);
}
