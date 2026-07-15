import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Plus, Users } from "lucide-react";
import { useEffect, useMemo } from "react";
import { listMyTeams, type Team } from "@/services/teams.service";
import { useUser } from "@/stores/authStore";

/**
 * Consultant-mode project create step: pick a team to attach as primary.
 * Defaults to the consultant's personal team if present; offers an
 * explicit "No team — attach later" opt-out so the consultant can
 * create a project without forcing an attachment.
 */
export function ProjectTeamPicker({
	value,
	onChange,
}: {
	/** Selected team id, or null for "No team". */
	value: string | null;
	onChange: (teamId: string | null) => void;
}) {
	const user = useUser();
	const teamsQuery = useQuery({
		queryKey: ["teams", "mine", user?.id ?? "anonymous"] as const,
		queryFn: listMyTeams,
		enabled: Boolean(user?.id),
		staleTime: 30 * 1000,
	});
	const teams = useMemo(
		() => (teamsQuery.data as Team[] | undefined) ?? [],
		[teamsQuery.data],
	);
	const personalTeam = useMemo(
		() => teams.find((t) => t.is_personal) ?? null,
		[teams],
	);

	// Default selection on first load: personal team if present, else
	// the first team alphabetically, else "No team".
	useEffect(() => {
		if (value !== null) return;
		if (teamsQuery.isPending) return;
		if (personalTeam) {
			onChange(personalTeam.id);
		} else if (teams.length > 0) {
			const sorted = [...teams].sort((a, b) => a.name.localeCompare(b.name));
			onChange(sorted[0].id);
		}
		// If teams.length === 0 we leave value=null ("No team").
	}, [value, teamsQuery.isPending, personalTeam, teams, onChange]);

	return (
		<div>
			<p className="mb-2 block text-sm font-semibold text-foreground">
				Primary team
			</p>
			<p className="mb-3 text-xs text-muted-foreground">
				The team whose members can be curated onto this project. Rates and
				billing settings come from the team. You can change this later from
				project settings.
			</p>

			<div className="space-y-2">
				{teamsQuery.isPending ? (
					<div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
						Loading your teams…
					</div>
				) : (
					<>
						{teams.map((team) => (
							<TeamOption
								key={team.id}
								team={team}
								selected={value === team.id}
								onSelect={() => onChange(team.id)}
							/>
						))}
						<NoTeamOption
							selected={value === null}
							onSelect={() => onChange(null)}
						/>
					</>
				)}
			</div>

			<div className="mt-3 text-right">
				<Link
					to="/teams"
					className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80"
				>
					<Plus className="h-3.5 w-3.5" />
					Manage teams
				</Link>
			</div>
		</div>
	);
}

function TeamOption({
	team,
	selected,
	onSelect,
}: {
	team: Team;
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onSelect}
			className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${
				selected
					? "border-primary bg-primary/10 shadow-sm"
					: "border-border bg-card hover:border-primary/50 hover:bg-muted/60"
			}`}
		>
			<TeamAvatar team={team} />
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate text-sm font-semibold text-foreground">
						{team.name}
					</span>
					{team.is_personal && (
						<span className="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
							Personal
						</span>
					)}
				</div>
				{team.description && (
					<p className="mt-0.5 truncate text-xs text-muted-foreground">
						{team.description}
					</p>
				)}
			</div>
			{selected && <Check className="h-5 w-5 shrink-0 text-primary" />}
		</button>
	);
}

function NoTeamOption({
	selected,
	onSelect,
}: {
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onSelect}
			className={`flex w-full items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-left transition ${
				selected
					? "border-primary bg-primary/10 shadow-sm"
					: "border-border bg-card hover:border-primary/50 hover:bg-muted/60"
			}`}
		>
			<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
				<Users className="h-4 w-4" />
			</div>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-semibold text-foreground">
					No team — attach later
				</p>
				<p className="mt-0.5 text-xs text-muted-foreground">
					Create the project unattached. Add a team from project settings when
					you're ready.
				</p>
			</div>
			{selected && <Check className="h-5 w-5 shrink-0 text-primary" />}
		</button>
	);
}

function TeamAvatar({ team }: { team: Team }) {
	if (team.avatar_url) {
		return (
			<img
				src={team.avatar_url}
				alt={team.name}
				className="h-9 w-9 shrink-0 rounded-lg object-cover"
			/>
		);
	}
	const initial = (team.name?.trim()[0] || "T").toUpperCase();
	return (
		<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
			<span className="text-sm font-semibold">{initial}</span>
		</div>
	);
}
