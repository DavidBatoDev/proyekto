import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { Check, Plus, Users } from "lucide-react";
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
			<label className="block text-sm font-semibold text-[#333438] mb-2">
				Primary team
			</label>
			<p className="mb-3 text-xs text-[#5c5e66]">
				The team whose members can be curated onto this project. Rates and
				billing settings come from the team. You can change this later from
				project settings.
			</p>

			<div className="space-y-2">
				{teamsQuery.isPending ? (
					<div className="rounded-lg border border-[#e3e5e8] bg-white px-4 py-3 text-sm text-[#5c5e66]">
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
					className="inline-flex items-center gap-1 text-xs font-semibold text-[#ff6b35] hover:text-[#e91e63]"
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
					? "border-[#ff6b35] bg-[#fff5eb] shadow-sm"
					: "border-[#e3e5e8] bg-white hover:border-[#ff993380]"
			}`}
		>
			<TeamAvatar team={team} />
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate text-sm font-semibold text-[#2f302f]">
						{team.name}
					</span>
					{team.is_personal && (
						<span className="inline-flex items-center rounded-full border border-[#ff993340] bg-[#fff5eb] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#b3530b]">
							Personal
						</span>
					)}
				</div>
				{team.description && (
					<p className="mt-0.5 truncate text-xs text-[#5c5e66]">
						{team.description}
					</p>
				)}
			</div>
			{selected && <Check className="h-5 w-5 shrink-0 text-[#ff6b35]" />}
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
					? "border-[#ff6b35] bg-[#fff5eb] shadow-sm"
					: "border-[#cbd5e1] bg-white hover:border-[#94a3b8]"
			}`}
		>
			<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f1f5f9] text-[#64748b]">
				<Users className="h-4 w-4" />
			</div>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-semibold text-[#2f302f]">
					No team — attach later
				</p>
				<p className="mt-0.5 text-xs text-[#5c5e66]">
					Create the project unattached. Add a team from project settings
					when you're ready.
				</p>
			</div>
			{selected && <Check className="h-5 w-5 shrink-0 text-[#ff6b35]" />}
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
		<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
			<span className="text-sm font-semibold">{initial}</span>
		</div>
	);
}
