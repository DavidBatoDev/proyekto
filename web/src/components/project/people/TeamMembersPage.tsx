import { Link } from "@tanstack/react-router";
import { Loader2, Search, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import {
	AppEmptyState,
	AppSectionHeader,
} from "@/components/common/AppPrimitives";
import { displayNameOf } from "@/components/common/MemberDisplay";
import { InviteToProjectModal } from "@/components/project/team/InviteToProjectModal";
import { useUser } from "@/stores/authStore";
import { PeopleAccessSummary, type PeopleFilter } from "./PeopleAccessSummary";
import { PersonRow, primaryTeamFor, teamOriginFor } from "./PersonRow";
import { type PersonAccess, useProjectPeople } from "./useProjectPeople";

/**
 * The project's Members page — one flat roster of everyone with access,
 * tagged with where that access comes from (direct or a team name).
 *
 * Team-grouped management (attach/detach/curate) lives on the Teams page;
 * this page is purely "who's on this project", replacing what used to be
 * five different member-list renderings across four tabs.
 */
export function TeamMembersPage({
	projectId,
	onOpenPerson,
}: {
	projectId: string;
	onOpenPerson: (person: PersonAccess) => void;
}) {
	const user = useUser();
	const people = useProjectPeople(projectId, user?.id ?? null);
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<PeopleFilter>("all");
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

	const visiblePeople = people.people.filter(matches);
	const nothingMatches = visiblePeople.length === 0;

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
				kicker="Team"
				title="Who's on this project"
				subtitle="Everyone with access, and where that access comes from."
				rightSlot={
					people.canManageMembers && (
						<button
							type="button"
							onClick={() => setInviteOpen(true)}
							className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted"
						>
							<UserPlus className="h-3.5 w-3.5" />
							Invite
						</button>
					)
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
				<section className="overflow-hidden rounded-2xl border border-border bg-card">
					<div className="divide-y divide-border">
						{visiblePeople.map((person) => (
							<PersonRow
								key={person.key}
								person={person}
								badgeTeam={primaryTeamFor(person, people.teamById)}
								origin={
									teamOriginFor(person, people.teamById) ?? { label: "Direct" }
								}
								onOpen={onOpenPerson}
							/>
						))}
					</div>
				</section>
			)}

			<Link
				to="/project/$projectId/team/catalog"
				params={{ projectId }}
				className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary underline-offset-2 hover:underline"
			>
				What do these access levels mean?
			</Link>

			{inviteOpen && (
				<InviteToProjectModal
					projectId={projectId}
					onClose={() => setInviteOpen(false)}
				/>
			)}
		</div>
	);
}
