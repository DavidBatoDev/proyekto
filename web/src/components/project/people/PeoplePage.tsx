import { HelpCircle, Loader2, Search, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import {
	AppEmptyState,
	AppSectionHeader,
} from "@/components/common/AppPrimitives";
import { displayNameOf } from "@/components/common/MemberDisplay";
import { InviteToProjectModal } from "@/components/project/team/InviteToProjectModal";
import { useUser } from "@/stores/authStore";
import { AttachTeamDialog } from "./AttachTeamDialog";
import { PeopleAccessSummary, type PeopleFilter } from "./PeopleAccessSummary";
import { PersonRow } from "./PersonRow";
import { TeamGroupCard } from "./TeamGroupCard";
import { type PersonAccess, useProjectPeople } from "./useProjectPeople";

/**
 * The project's single people surface.
 *
 * Replaces four tabs — People, Teams, Permissions, Catalog — that between them
 * rendered the member list five different ways. Teams are collapsible groups
 * inside the one roster, per-person access opens a drawer instead of navigating
 * away, and the permission catalog moved behind a "what do these mean?" link.
 */
export function PeoplePage({
	projectId,
	onOpenPerson,
	onOpenCatalog,
}: {
	projectId: string;
	onOpenPerson: (person: PersonAccess) => void;
	onOpenCatalog: () => void;
}) {
	const user = useUser();
	const people = useProjectPeople(projectId, user?.id ?? null);
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<PeopleFilter>("all");
	const [attachOpen, setAttachOpen] = useState(false);
	const [inviteOpen, setInviteOpen] = useState(false);

	const matches = useMemo(() => {
		const q = query.trim().toLowerCase();
		return (person: PersonAccess) => {
			if (filter === "can-edit" && !person.likelyCanEdit) return false;
			if (filter === "view-only" && person.likelyCanEdit) return false;
			if (filter === "external" && !person.isExternal) return false;
			if (!q) return true;
			const haystack = [
				displayNameOf(person.user, person.userId ?? undefined),
				person.user?.email ?? "",
				person.position ?? "",
				person.role,
			]
				.join(" ")
				.toLowerCase();
			return haystack.includes(q);
		};
	}, [query, filter]);

	const visibleDirect = people.direct.filter(matches);
	const visibleGroups = people.groups
		.map((g) => ({ ...g, people: g.people.filter(matches) }))
		// While filtering, an empty group is noise; unfiltered it is a real state
		// ("nobody from this team yet") worth showing.
		.filter(
			(g) =>
				g.people.length > 0 || (filter === "all" && query.trim().length === 0),
		);

	const nothingMatches =
		visibleDirect.length === 0 &&
		visibleGroups.every((g) => g.people.length === 0);

	if (people.isPending) {
		return (
			<div className="flex justify-center py-16">
				<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="space-y-5">
			<AppSectionHeader
				kicker="People"
				title="Who's on this project"
				subtitle="Everyone with access, and where that access comes from."
				rightSlot={
					<div className="flex items-center gap-2">
						{people.canManageMembers && (
							<button
								type="button"
								onClick={() => setInviteOpen(true)}
								className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted"
							>
								<UserPlus className="h-3.5 w-3.5" />
								Invite
							</button>
						)}
						{people.canManageTeams && (
							<button
								type="button"
								onClick={() => setAttachOpen(true)}
								className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
							>
								<Users className="h-3.5 w-3.5" />
								Attach team
							</button>
						)}
					</div>
				}
			/>

			<PeopleAccessSummary
				summary={people.summary}
				active={filter}
				onChange={setFilter}
			/>

			<div className="relative">
				<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
				<input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search people…"
					aria-label="Search people"
					className="w-full rounded-lg border border-input bg-card py-2 pl-9 pr-3 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
				/>
			</div>

			{nothingMatches ? (
				<AppEmptyState
					icon={Users}
					title="Nobody matches"
					description="Try a different search, or clear the filter."
				/>
			) : (
				<div className="space-y-4">
					{visibleDirect.length > 0 && (
						<section className="overflow-hidden rounded-2xl border border-border bg-card">
							<div className="border-b border-border bg-muted/40 px-4 py-2.5">
								<p className="text-sm font-semibold text-foreground">
									Direct members
								</p>
								<p className="text-[11px] text-muted-foreground">
									Added to this project individually, not through a team.
								</p>
							</div>
							<div className="divide-y divide-border">
								{visibleDirect.map((person) => (
									<PersonRow
										key={person.key}
										person={person}
										onOpen={onOpenPerson}
									/>
								))}
							</div>
						</section>
					)}

					{visibleGroups.map((group) => (
						<TeamGroupCard
							key={group.attachment.team_id}
							projectId={projectId}
							group={group}
							canManageTeams={people.canManageTeams}
							canManageMembers={people.canManageMembers}
							defaultOpen={
								group.attachment.is_primary || group.people.length <= 5
							}
							onOpenPerson={onOpenPerson}
							onAddMember={() => setAttachOpen(true)}
						/>
					))}
				</div>
			)}

			<button
				type="button"
				onClick={onOpenCatalog}
				className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary underline-offset-2 hover:underline"
			>
				<HelpCircle className="h-3.5 w-3.5" />
				What do these access levels mean?
			</button>

			{attachOpen && (
				<AttachTeamDialog
					projectId={projectId}
					currentUserId={user?.id ?? null}
					onClose={() => setAttachOpen(false)}
				/>
			)}
			{inviteOpen && (
				<InviteToProjectModal
					projectId={projectId}
					onClose={() => setInviteOpen(false)}
				/>
			)}
		</div>
	);
}
