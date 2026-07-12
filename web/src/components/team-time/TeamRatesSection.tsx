import { Loader2, Plus, Settings2 } from "lucide-react";
import type { TeamMember, TeamMemberRate } from "@/services/teams.service";
import { initialsFromName } from "./time-utils";

function memberDisplayName(m: TeamMember): string {
	const composed = [m.user?.first_name, m.user?.last_name]
		.filter(Boolean)
		.join(" ")
		.trim();
	return m.user?.display_name || composed || m.user?.email || m.user_id;
}

function RateCardSkeleton() {
	return (
		<div className="flex min-h-[280px] w-full animate-pulse flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm sm:w-[240px]">
			<div className="h-14 bg-muted" />
			<div className="px-3 pb-3 -mt-7 flex-1 flex flex-col">
				<div className="mx-auto h-14 w-14 rounded-full border-4 border-card bg-muted shadow-sm" />
				
				<div className="mt-2.5 space-y-2 text-center">
					<div className="mx-auto h-4 w-32 rounded bg-muted" />
					<div className="mx-auto h-3 w-40 rounded bg-muted" />
				</div>

				<div className="mt-3 rounded-lg border border-border bg-muted/60 p-2">
					<div className="mx-auto h-4 w-24 rounded bg-muted-foreground/20" />
					<div className="mx-auto mt-1.5 h-3 w-16 rounded bg-muted-foreground/15" />
				</div>

				<div className="mt-auto flex items-center justify-center gap-1.5 border-t border-border pt-3">
					<div className="h-6 w-16 rounded bg-muted" />
					<div className="h-6 w-16 rounded bg-muted" />
				</div>
			</div>
		</div>
	);
}

interface TeamRatesSectionProps {
	members: TeamMember[];
	activeRatesByUserId: Record<string, TeamMemberRate[]>;
	projectTitleById: Record<string, string | null>;
	loadingMembers: boolean;
	loadingRates: boolean;
	canManageRates: boolean;
	pendingMemberById: Record<string, boolean>;
	onViewLogs: (member: TeamMember) => void;
	onOpenAddRate: () => void;
	onManageMember: (member: TeamMember) => void;
}

function formatRateSummary(
	rates: TeamMemberRate[],
	projectTitleById: Record<string, string | null>,
): { headline: string; sub: string } {
	if (rates.length === 0) {
		return { headline: "No active rate", sub: "" };
	}
	if (rates.length === 1) {
		const r = rates[0];
		const title = projectTitleById[r.project_id] ?? "Project";
		const real = Number(r.hourly_rate).toFixed(2);
		const training = Number(r.training_hourly_rate).toFixed(2);
		return {
			headline: `Work ${real} ${r.currency || "USD"}/hr`,
			sub: `Training ${training} ${r.currency || "USD"}/hr · ${title || "(untitled project)"}`,
		};
	}
	const distinctValues = new Set(
		rates.map(
			(r) =>
				`${Number(r.hourly_rate).toFixed(2)}-${Number(r.training_hourly_rate).toFixed(2)}-${r.currency}`,
		),
	);
	if (distinctValues.size === 1) {
		const r = rates[0];
		return {
			headline: `Work ${Number(r.hourly_rate).toFixed(2)} ${r.currency || "USD"}/hr`,
			sub: `Training ${Number(r.training_hourly_rate).toFixed(2)} ${r.currency || "USD"}/hr · ${rates.length} projects`,
		};
	}
	return {
		headline: `${rates.length} project rates`,
		sub: "Mixed rates",
	};
}

export function TeamRatesSection({
	members,
	activeRatesByUserId,
	projectTitleById,
	loadingMembers,
	loadingRates,
	canManageRates,
	pendingMemberById,
	onViewLogs,
	onOpenAddRate,
	onManageMember,
}: TeamRatesSectionProps) {
	const ratedMembers = members.filter(
		(m) => (activeRatesByUserId[m.user_id]?.length ?? 0) > 0,
	);

	const isLoading = loadingMembers || loadingRates;

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between gap-3">
				<div>
					<h2 className="text-base font-semibold text-foreground">
						Team Member Time Rates
					</h2>
					<p className="mt-0.5 text-xs text-muted-foreground">
						Members need at least one active project rate before they can use
						the My Logs tab.
					</p>
				</div>
				{canManageRates && (
					<button
						type="button"
						onClick={onOpenAddRate}
						className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-2 text-xs font-semibold text-foreground hover:bg-accent hover:text-accent-foreground"
					>
						<Plus className="w-3.5 h-3.5" />
						Add Rate
					</button>
				)}
			</div>

			<div className="space-y-3">
				{isLoading ? (
					<div className="flex flex-wrap gap-4">
						<RateCardSkeleton />
						<RateCardSkeleton />
						<RateCardSkeleton />
					</div>
				) : ratedMembers.length === 0 ? (
					<div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
						<p className="text-sm text-muted-foreground">No time rates set yet.</p>
					</div>
				) : (
					<div className="flex flex-wrap gap-4">
						{ratedMembers.map((member) => {
							const isPending = Boolean(pendingMemberById[member.user_id]);
							const rates = activeRatesByUserId[member.user_id] ?? [];
							const { headline, sub } = formatRateSummary(
								rates,
								projectTitleById,
							);
							const memberName = memberDisplayName(member);
							const roleLabel =
								member.role.charAt(0).toUpperCase() + member.role.slice(1);
							const positionLabel =
								(member.position || "").trim() || "Team Member";
							const avatarUrl = member.user?.avatar_url;
							const preview = rates.slice(0, 3);
							const remaining = rates.length - preview.length;

							return (
								<div
									key={member.id}
									className={`flex min-h-[280px] w-full flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-sm sm:w-[240px] ${
										isPending ? "ring-1 ring-warning/50" : ""
									}`}
								>
									<div className="h-14 bg-linear-to-r from-muted via-muted/70 to-card" />
									<div className="px-3 pb-3 -mt-7 flex-1 flex flex-col">
										<div className="mx-auto flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-4 border-card bg-muted shadow-sm">
											{avatarUrl ? (
												<img
													src={avatarUrl}
													alt={memberName}
													className="h-full w-full object-cover"
												/>
											) : (
												<span className="text-xs font-semibold text-muted-foreground">
													{initialsFromName(memberName)}
												</span>
											)}
										</div>

										<div className="mt-2.5 text-center">
											<div className="flex items-center justify-center gap-1.5">
												<p className="text-sm font-semibold leading-tight text-card-foreground">
													{memberName}
												</p>
												{isPending && (
													<Loader2
														className="h-3.5 w-3.5 animate-spin text-muted-foreground"
														aria-label="Rate pending"
													/>
												)}
											</div>
											<p className="mt-1 text-[11px] text-muted-foreground">
												{roleLabel} | {positionLabel}
											</p>
										</div>

										<div className="mt-3 rounded-lg border border-border bg-muted/50 p-2">
											<div className="text-center">
												<p className="text-sm font-semibold text-card-foreground">
													{headline}
												</p>
												{sub && (
													<p className="mt-0.5 text-[11px] text-muted-foreground">
														{sub}
													</p>
												)}
											</div>
											{rates.length > 1 && (
												<div className="mt-2 space-y-0.5 border-t border-border pt-2">
							{preview.map((r) => (
								<div
									key={r.id}
									className="flex items-center justify-between gap-2 text-[10.5px]"
								>
									<span className="truncate text-muted-foreground">
										{projectTitleById[r.project_id] ?? "Project"}
									</span>
									<span className="font-medium text-card-foreground tabular-nums">
										Work {Number(r.hourly_rate).toFixed(2)} / Training{" "}
										{Number(r.training_hourly_rate).toFixed(2)}{" "}
										{r.currency || "USD"}
									</span>
								</div>
							))}
													{remaining > 0 && (
														<p className="text-center text-[10.5px] text-muted-foreground">
															+{remaining} more
														</p>
													)}
												</div>
											)}
										</div>

										<div className="mt-auto border-t border-border pt-3">
											<div className="flex flex-wrap items-center justify-center gap-1.5">
												<button
													type="button"
													onClick={() => onViewLogs(member)}
													disabled={isPending}
													className="rounded-md border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
												>
													View Logs
												</button>
												{canManageRates && (
													<button
														type="button"
														onClick={() => onManageMember(member)}
														disabled={isPending}
														className="inline-flex items-center gap-1 rounded-md border border-primary/35 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
													>
														<Settings2 className="h-3.5 w-3.5" />
														Manage
													</button>
												)}
											</div>
										</div>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
