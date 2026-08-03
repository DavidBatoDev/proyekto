import {
	Building2,
	ChevronRight,
	Eye,
	Pencil,
	User,
	Users,
} from "lucide-react";
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
/** Where a person's access comes from, as the row shows it. */
export interface PersonOrigin {
	label: string;
	/** The team's logo, when the origin is a team that has one. */
	avatarUrl?: string | null;
}

export function PersonRow({
	person,
	badgeTeam,
	origin,
	onOpen,
}: {
	person: PersonAccess;
	/** Team whose logo marks this person as internal, if any. */
	badgeTeam?: Team | null;
	/** Where this person's access comes from — shown as a trailing badge. */
	origin?: PersonOrigin;
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
							{origin && (
								<SemanticBadge
									icon={Users}
									iconClassName="text-muted-foreground"
									leading={
										origin.avatarUrl ? (
											<img
												src={origin.avatarUrl}
												alt=""
												className="h-4 w-4 shrink-0 rounded-[4px] object-cover ring-1 ring-border"
											/>
										) : undefined
									}
								>
									{origin.label}
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

/**
 * The team a person's access comes through. On a flat roster nobody sits under
 * a team heading, so this is what tells the row — chip and avatar badge alike —
 * which logo to wear. Null when the access is direct.
 */
export function primaryTeamFor(
	person: { teamIds: string[] },
	teamById: Record<string, Team>,
): Team | null {
	if (person.teamIds.length === 0) return null;
	return teamById[person.teamIds[0]] ?? null;
}

/**
 * That team as a badge — logo included, so the chip reads the same way a team
 * does on the Teams page. Undefined when the access is direct; callers decide
 * whether that deserves its own label.
 */
export function teamOriginFor(
	person: { teamIds: string[] },
	teamById: Record<string, Team>,
): PersonOrigin | undefined {
	if (person.teamIds.length === 0) return undefined;
	const first = primaryTeamFor(person, teamById);
	const name = first?.name ?? "Team";
	const extra = person.teamIds.length - 1;
	return {
		label: extra > 0 ? `${name} +${extra}` : name,
		avatarUrl: first?.avatar_url ?? null,
	};
}
