import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { MemberDisplay } from "@/components/common/MemberDisplay";
import { useToast } from "@/hooks/useToast";
import {
	computeDetachOutcomes,
	type DetachCandidate,
	type DetachKeepReason,
} from "@/lib/detachOutcomes";
import { projectKeys } from "@/queries/project";
import { teamKeys } from "@/queries/teams";
import {
	detachTeam,
	type ProjectTeam,
	type TeamSummary,
} from "@/services/teams.service";
import type { PersonAccess } from "./useProjectPeople";

/**
 * The detach confirmation. Replaces a boolean confirm() whose copy claimed
 * everyone from the team loses access — direct members, owners, and people
 * on another attached team actually keep it — and adds the choice that
 * copy was missing: detach can now also KEEP the team-sourced members, by
 * promoting them to direct project members before the attachment goes.
 *
 * The outcome preview is a client-side prediction (computeDetachOutcomes
 * mirrors the DB trigger); the trigger stays authoritative.
 */

type DetachMode = "remove" | "keep";

type Candidate = DetachCandidate & { person: PersonAccess };

export function DetachTeamDialog({
	projectId,
	attachment,
	team,
	people,
	curatedTeamIdsByUserId,
	teamNameById,
	onClose,
}: {
	projectId: string;
	attachment: ProjectTeam;
	team: TeamSummary | null;
	people: PersonAccess[];
	curatedTeamIdsByUserId: Map<string, Set<string>>;
	teamNameById: Record<string, string>;
	onClose: () => void;
}) {
	const qc = useQueryClient();
	const toast = useToast();
	const teamId = attachment.team_id;
	const teamName = team?.name ?? "this team";
	const [mode, setMode] = useState<DetachMode>("remove");

	const outcomes = useMemo(() => {
		const candidates: Candidate[] = people.map((person) => ({
			person,
			userId: person.userId,
			role: person.role,
			hasDirectGrant: person.rows.some((r) => r.has_direct_grant === true),
			curatedTeamIds: person.userId
				? Array.from(curatedTeamIdsByUserId.get(person.userId) ?? [])
				: [],
		}));
		return computeDetachOutcomes(candidates, teamId);
	}, [people, curatedTeamIdsByUserId, teamId]);

	const affected = outcomes.losesAccess;
	// Only people actually curated on this team belong in the preview;
	// "not-curated" rows are the rest of the project roster.
	const keptCurated = outcomes.keepsAccess.filter(
		(k) => k.reason !== "not-curated",
	);

	const detachMutation = useMutation({
		mutationFn: () => detachTeam(projectId, teamId, { members: mode }),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["project", projectId, "teams"] });
			void qc.invalidateQueries({ queryKey: projectKeys.members(projectId) });
			void qc.invalidateQueries({
				queryKey: ["project", projectId, "teams", teamId, "curated-members"],
			});
			void qc.invalidateQueries({ queryKey: teamKeys.projects(teamId) });
			toast.success(
				mode === "keep"
					? `${teamName} detached — members kept`
					: `${teamName} detached`,
			);
			onClose();
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const keepReasonLabel = (
		candidate: Candidate,
		reason: DetachKeepReason,
	): string => {
		if (reason === "owner") return "Owner — always keeps access";
		if (reason === "direct") return "Direct member";
		const others = candidate.curatedTeamIds
			.filter((id) => id !== teamId)
			.map((id) => teamNameById[id])
			.filter(Boolean);
		return others.length > 0
			? `Also on ${others.join(", ")}`
			: "Also on another attached team";
	};

	const optionClass = (active: boolean) =>
		`flex w-full cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition ${
			active ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
		}`;

	return (
		<AppDialog
			open
			onClose={onClose}
			size="md"
			busy={detachMutation.isPending}
			title={`Detach ${teamName}?`}
			description="The team itself isn't changed, and you can attach it again later."
			footer={
				<>
					<button
						type="button"
						onClick={onClose}
						disabled={detachMutation.isPending}
						className="rounded-lg border border-input px-4 py-2 text-sm text-foreground transition hover:bg-muted disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => detachMutation.mutate()}
						disabled={detachMutation.isPending}
						className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${
							mode === "remove"
								? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
								: "bg-primary text-primary-foreground hover:bg-primary/90"
						}`}
					>
						{detachMutation.isPending && (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						)}
						{mode === "remove" ? "Detach team" : "Detach & keep members"}
					</button>
				</>
			}
		>
			<div className="space-y-5">
				<div>
					<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						What happens to its members
					</p>
					<div className="space-y-1.5">
						<label className={optionClass(mode === "remove")}>
							<input
								type="radio"
								name="detach-mode"
								checked={mode === "remove"}
								onChange={() => setMode("remove")}
								disabled={detachMutation.isPending}
								className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
							/>
							<span className="text-xs text-foreground">
								<span className="font-semibold">
									Remove members brought by this team
								</span>
								<span className="mt-0.5 block text-[11px] text-muted-foreground">
									{affected.length === 0
										? "Nobody would lose access — everyone here also has direct access or another attached team."
										: `${affected.length} ${
												affected.length === 1 ? "person loses" : "people lose"
											} access to this project — listed below.`}
								</span>
							</span>
						</label>
						<label className={optionClass(mode === "keep")}>
							<input
								type="radio"
								name="detach-mode"
								checked={mode === "keep"}
								onChange={() => setMode("keep")}
								disabled={detachMutation.isPending}
								className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
							/>
							<span className="text-xs text-foreground">
								<span className="font-semibold">
									Keep them as direct project members
								</span>
								<span className="mt-0.5 block text-[11px] text-muted-foreground">
									Everyone stays on the project with their current role — no
									longer tied to the team.
								</span>
							</span>
						</label>
					</div>
				</div>

				{affected.length > 0 && (
					<div>
						<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							{mode === "remove"
								? "Will lose access"
								: "Will stay as direct members"}
						</p>
						<div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
							{affected.map((candidate) => (
								<div
									key={candidate.person.key}
									className="flex items-center gap-3 px-3 py-2.5"
								>
									<div className="min-w-0 flex-1">
										<MemberDisplay
											user={candidate.person.user}
											fallbackId={candidate.userId ?? undefined}
											size="sm"
										/>
									</div>
									<span className="shrink-0 text-[11px] text-muted-foreground">
										{candidate.role} · via {teamName}
									</span>
								</div>
							))}
						</div>
					</div>
				)}

				{keptCurated.length > 0 && (
					<div>
						<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Keeps access either way
						</p>
						<div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
							{keptCurated.map(({ person: candidate, reason }) => (
								<div
									key={candidate.person.key}
									className="flex items-center gap-3 px-3 py-2.5 opacity-60"
								>
									<div className="min-w-0 flex-1">
										<MemberDisplay
											user={candidate.person.user}
											fallbackId={candidate.userId ?? undefined}
											size="sm"
										/>
									</div>
									<span className="shrink-0 text-[11px] text-muted-foreground">
										{keepReasonLabel(candidate, reason)}
									</span>
								</div>
							))}
						</div>
					</div>
				)}

				{attachment.is_primary && (
					<p className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground">
						This is the primary team. Detaching it clears that — contracts and
						invoicing stop using its billing identity and pay periods until you
						make another team primary.
					</p>
				)}
			</div>
		</AppDialog>
	);
}
