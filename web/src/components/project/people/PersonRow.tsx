import { Building2, ChevronRight, Eye, Pencil, User } from "lucide-react";
import type { AvatarBadge } from "@/components/common/Avatar";
import { MemberDisplay } from "@/components/common/MemberDisplay";
import {
	PositionBadge,
	SemanticBadge,
} from "@/components/common/SemanticBadge";
import type { Team } from "@/services/teams.service";
import type { PersonAccess } from "./useProjectPeople";

/**
 * One person, rendered one way.
 *
 * This replaces five separate row renderings that had drifted apart — two in
 * TeamPage, two in ProjectTeamsPanel, one in the permissions table — each with
 * its own chips and its own idea of what "role" meant.
 *
 * The whole row is the click target: it opens the access drawer. That is the
 * single most common thing anyone wants from a roster.
 */
export function PersonRow({
	person,
	badgeTeam,
	onOpen,
}: {
	person: PersonAccess;
	/** Team whose logo marks this person as internal, if any. */
	badgeTeam?: Team | null;
	onOpen: (person: PersonAccess) => void;
}) {
	const badge: AvatarBadge | null = person.isExternal
		? { kind: "external", title: "External — not on one of your teams" }
		: badgeTeam
			? {
					kind: "team",
					team: { name: badgeTeam.name, avatar_url: badgeTeam.avatar_url },
					title: `On ${badgeTeam.name}`,
				}
			: null;

	return (
		<button
			type="button"
			onClick={() => onOpen(person)}
			className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/60"
		>
			<div className="min-w-0 flex-1">
				<MemberDisplay
					user={person.user}
					fallbackId={person.userId ?? undefined}
					badge={badge}
					subtitleSlot={
						<>
							<SemanticBadge
								icon={person.likelyCanEdit ? Pencil : Eye}
								iconClassName={
									person.likelyCanEdit ? "text-info" : "text-muted-foreground"
								}
							>
								{person.likelyCanEdit ? "Can edit" : "View only"}
							</SemanticBadge>
							{person.position && (
								<PositionBadge>{person.position}</PositionBadge>
							)}
							{person.isExternal && (
								<SemanticBadge icon={Building2} iconClassName="text-warning">
									External
								</SemanticBadge>
							)}
							{person.isSelf && (
								<SemanticBadge
									icon={User}
									iconClassName="text-muted-foreground"
								>
									You
								</SemanticBadge>
							)}
						</>
					}
				/>
			</div>
			<span className="shrink-0 text-xs capitalize text-muted-foreground">
				{person.role}
			</span>
			<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
		</button>
	);
}
