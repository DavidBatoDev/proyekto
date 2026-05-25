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
		<div className="w-full sm:w-[240px] rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden animate-pulse min-h-[280px] flex flex-col">
			<div className="h-14 bg-gray-100" />
			<div className="px-3 pb-3 -mt-7 flex-1 flex flex-col">
				<div className="mx-auto h-14 w-14 rounded-full border-4 border-white bg-gray-200 shadow-sm" />
				
				<div className="mt-2.5 space-y-2 text-center">
					<div className="mx-auto h-4 w-32 rounded bg-gray-200" />
					<div className="mx-auto h-3 w-40 rounded bg-gray-100" />
				</div>

				<div className="mt-3 rounded-lg border border-gray-100 bg-gray-50/70 p-2">
					<div className="mx-auto h-4 w-24 rounded bg-gray-200" />
					<div className="mx-auto h-3 w-16 rounded bg-gray-100 mt-1.5" />
				</div>

				<div className="mt-auto pt-3 border-t border-gray-100 flex items-center justify-center gap-1.5">
					<div className="h-6 w-16 rounded bg-gray-200" />
					<div className="h-6 w-16 rounded bg-gray-200" />
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
					<h2 className="text-base font-semibold text-gray-900">
						Team Member Time Rates
					</h2>
					<p className="text-xs text-gray-500 mt-0.5">
						Members need at least one active project rate before they can use
						the My Logs tab.
					</p>
				</div>
				{canManageRates && (
					<button
						type="button"
						onClick={onOpenAddRate}
						className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200"
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
					<div className="bg-white rounded-2xl border border-dashed border-gray-200 p-12 text-center">
						<p className="text-sm text-gray-500">No time rates set yet.</p>
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
									className={`w-full sm:w-[240px] rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden min-h-[280px] flex flex-col ${
										isPending ? "ring-1 ring-amber-300/60 bg-amber-50/20" : ""
									}`}
								>
									<div className="h-14 bg-gradient-to-r from-slate-200 via-slate-100 to-slate-50" />
									<div className="px-3 pb-3 -mt-7 flex-1 flex flex-col">
										<div className="mx-auto h-14 w-14 rounded-full border-4 border-white bg-white shadow-sm overflow-hidden flex items-center justify-center">
											{avatarUrl ? (
												<img
													src={avatarUrl}
													alt={memberName}
													className="h-full w-full object-cover"
												/>
											) : (
												<span className="text-xs font-semibold text-gray-700">
													{initialsFromName(memberName)}
												</span>
											)}
										</div>

										<div className="mt-2.5 text-center">
											<div className="flex items-center justify-center gap-1.5">
												<p className="text-sm font-semibold text-gray-900 leading-tight">
													{memberName}
												</p>
												{isPending && (
													<Loader2
														className="h-3.5 w-3.5 animate-spin text-slate-700"
														aria-label="Rate pending"
													/>
												)}
											</div>
											<p className="text-[11px] text-gray-500 mt-1">
												{roleLabel} | {positionLabel}
											</p>
										</div>

										<div className="mt-3 rounded-lg border border-gray-100 bg-gray-50/70 p-2">
											<div className="text-center">
												<p className="text-sm font-semibold text-slate-800">
													{headline}
												</p>
												{sub && (
													<p className="text-[11px] text-slate-500 mt-0.5">
														{sub}
													</p>
												)}
											</div>
											{rates.length > 1 && (
												<div className="mt-2 space-y-0.5 border-t border-gray-100 pt-2">
							{preview.map((r) => (
								<div
									key={r.id}
									className="flex items-center justify-between gap-2 text-[10.5px]"
								>
									<span className="truncate text-slate-500">
										{projectTitleById[r.project_id] ?? "Project"}
									</span>
									<span className="font-medium text-slate-700 tabular-nums">
										Work {Number(r.hourly_rate).toFixed(2)} / Training{" "}
										{Number(r.training_hourly_rate).toFixed(2)}{" "}
										{r.currency || "USD"}
									</span>
								</div>
							))}
													{remaining > 0 && (
														<p className="text-[10.5px] text-slate-400 text-center">
															+{remaining} more
														</p>
													)}
												</div>
											)}
										</div>

										<div className="mt-auto pt-3 border-t border-gray-100">
											<div className="flex flex-wrap items-center justify-center gap-1.5">
												<button
													type="button"
													onClick={() => onViewLogs(member)}
													disabled={isPending}
													className="px-2.5 py-1 text-xs font-semibold rounded-md border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
												>
													View Logs
												</button>
												{canManageRates && (
													<button
														type="button"
														onClick={() => onManageMember(member)}
														disabled={isPending}
														className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md border border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100 disabled:opacity-50 disabled:cursor-not-allowed"
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
