import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Loader2, ShieldCheck } from "lucide-react";
import { AppSectionHeader } from "@/components/common/AppPrimitives";
import { useUser } from "@/stores/authStore";
import { PersonRow } from "./PersonRow";
import { type PersonAccess, useProjectPeople } from "./useProjectPeople";

// Mirrors ROLE_DISPLAY in ProjectPermissions.tsx — kept local rather than
// exported from there, so that file's diff stays limited to link repointing.
const ROLE_TEMPLATE_LINKS: {
	key: string;
	label: string;
	description: string;
}[] = [
	{
		key: "consultant",
		label: "Consultant",
		description: "Default access for every consultant on this project.",
	},
	{
		key: "client",
		label: "Client",
		description: "Default access for every client on this project.",
	},
	{
		key: "freelancer",
		label: "Freelancer",
		description: "Default access for every freelancer on this project.",
	},
];

/**
 * Landing view for the Permissions page: pick a role template to edit its
 * default access, or pick a member to edit their personal override. Shown
 * whenever neither `?role=` nor `?memberId=` is set.
 */
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
				subtitle="Edit default access by role, or override it for one person."
			/>

			<section className="overflow-hidden rounded-2xl border border-border bg-card">
				<div className="border-b border-border bg-muted/40 px-4 py-2.5">
					<p className="text-sm font-semibold text-foreground">
						By role template
					</p>
				</div>
				<div className="divide-y divide-border">
					{ROLE_TEMPLATE_LINKS.map((template) => (
						<Link
							key={template.key}
							to="/project/$projectId/team/permissions"
							params={{ projectId }}
							search={{ role: template.key }}
							className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/60"
						>
							<ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
							<div className="min-w-0 flex-1">
								<p className="text-sm font-semibold text-foreground">
									{template.label}
								</p>
								<p className="truncate text-xs text-muted-foreground">
									{template.description}
								</p>
							</div>
							<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
						</Link>
					))}
				</div>
			</section>

			{people.people.length > 0 && (
				<section className="overflow-hidden rounded-2xl border border-border bg-card">
					<div className="border-b border-border bg-muted/40 px-4 py-2.5">
						<p className="text-sm font-semibold text-foreground">By member</p>
						<p className="text-[11px] text-muted-foreground">
							Custom overrides layer on top of that person's role template.
						</p>
					</div>
					<div className="divide-y divide-border">
						{people.people.map((person) => (
							<PersonRow
								key={person.key}
								person={person}
								originLabel={originLabelFor(person, people.teamNameById)}
								onOpen={openMember}
							/>
						))}
					</div>
				</section>
			)}
		</div>
	);
}

function originLabelFor(
	person: { teamIds: string[] },
	teamNameById: Record<string, string>,
): string | undefined {
	if (person.teamIds.length === 0) return undefined;
	const names = person.teamIds.map((id) => teamNameById[id] ?? "Team");
	return names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
}
