import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import type { TeamMember, TeamMemberRate } from "@/services/teams.service";

function formatRateDate(value?: string | null) {
	if (!value) return "—";
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return value;
	return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
		parsed,
	);
}

function memberDisplayName(m: TeamMember | null | undefined): string {
	if (!m) return "Unknown member";
	const composed = [m.user?.first_name, m.user?.last_name]
		.filter(Boolean)
		.join(" ")
		.trim();
	return m.user?.display_name || composed || m.user?.email || m.user_id;
}

interface TeamMemberRateHistoryDrawerProps {
	isOpen: boolean;
	member: TeamMember | null;
	rates: TeamMemberRate[];
	projectTitleById: Record<string, string | null>;
	loadingRates: boolean;
	canManage: boolean;
	rowPendingByRateId: Record<string, boolean>;
	onClose: () => void;
	onAddRate: () => void;
	onEditRate: (rate: TeamMemberRate) => void;
	onDeleteRate: (rate: TeamMemberRate) => void;
}

export function TeamMemberRateHistoryDrawer({
	isOpen,
	member,
	rates,
	projectTitleById,
	loadingRates,
	canManage,
	rowPendingByRateId,
	onClose,
	onAddRate,
	onEditRate,
	onDeleteRate,
}: TeamMemberRateHistoryDrawerProps) {
	const grouped = useMemo(() => {
		const map = new Map<string, TeamMemberRate[]>();
		for (const r of rates) {
			const arr = map.get(r.project_id) ?? [];
			arr.push(r);
			map.set(r.project_id, arr);
		}
		for (const arr of map.values()) {
			arr.sort((a, b) => {
				const aActive = a.end_date === null ? 1 : 0;
				const bActive = b.end_date === null ? 1 : 0;
				if (aActive !== bActive) return bActive - aActive;
				return (b.start_date ?? "").localeCompare(a.start_date ?? "");
			});
		}
		return Array.from(map.entries()).sort(([a], [b]) => {
			const titleA = projectTitleById[a] ?? "";
			const titleB = projectTitleById[b] ?? "";
			return titleA.localeCompare(titleB);
		});
	}, [rates, projectTitleById]);

	const open = isOpen && Boolean(member);
	const memberName = memberDisplayName(member);

	return (
		<MotionConfig reducedMotion="never">
		<AnimatePresence>
			{open && member && (
				<motion.div
					key="rate-history-drawer"
					className="fixed inset-0 z-160 flex justify-end bg-slate-900/55 backdrop-blur-[2px]"
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ duration: 0.22, ease: "easeOut" }}
					onClick={onClose}
				>
					<motion.div
						className="h-full w-full max-w-md bg-white shadow-2xl flex flex-col"
						initial={{ x: "100%" }}
						animate={{ x: 0 }}
						exit={{ x: "100%" }}
						transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
						onClick={(e) => e.stopPropagation()}
					>
						<div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
							<div>
								<h3 className="text-base font-semibold text-slate-900">
									Rate history
								</h3>
								<p className="text-xs text-slate-500 mt-0.5">{memberName}</p>
							</div>
							<button
								type="button"
								onClick={onClose}
								className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
							>
								<X className="h-4 w-4" />
							</button>
						</div>

						{canManage && (
							<div className="border-b border-slate-200 px-5 py-3">
								<button
									type="button"
									onClick={onAddRate}
									className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
								>
									<Plus className="h-3.5 w-3.5" />
									Add new rate
								</button>
								<p className="mt-2 text-[11px] text-slate-500">
									Adding a rate without an end date closes the previous active
									rate for each selected project automatically.
								</p>
							</div>
						)}

						<div className="flex-1 overflow-auto px-5 py-4">
							{loadingRates ? (
								<div className="flex justify-center py-8">
									<Loader2 className="h-5 w-5 animate-spin text-slate-400" />
								</div>
							) : grouped.length === 0 ? (
								<div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
									No rate history yet for this member.
								</div>
							) : (
								<div className="space-y-4">
									{grouped.map(([projectId, projectRates]) => (
										<div key={projectId}>
											<h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
												{projectTitleById[projectId] ?? "Untitled project"}
											</h4>
											<ol className="relative space-y-2 pl-6">
												{projectRates.length > 1 && (
													<span
														aria-hidden
														className="absolute left-2.5 -translate-x-1/2 top-4 bottom-4 w-px bg-slate-200"
													/>
												)}
												{projectRates.map((rate) => {
													const isActive = rate.end_date == null;
													const isPending = Boolean(
														rowPendingByRateId[rate.id],
													);
													return (
														<li
															key={rate.id}
															className={`relative rounded-lg border bg-white px-4 py-3 ${
																isActive
																	? "border-emerald-300 ring-1 ring-emerald-200/60"
																	: "border-slate-200"
															} ${isPending ? "opacity-60" : ""}`}
														>
															<span
																aria-hidden
																className={`absolute -left-3.5 top-4 -translate-x-1/2 h-3.5 w-3.5 rounded-full border-2 ${
																	isActive
																		? "border-emerald-500 bg-white"
																		: "border-slate-300 bg-slate-300"
																}`}
															/>
															<div className="flex items-start justify-between gap-3">
																<div className="space-y-1">
																	<div className="flex items-center gap-2">
																		<span className="text-sm font-semibold text-slate-900">
																			{Number(rate.hourly_rate).toFixed(2)}{" "}
																			{rate.currency}
																		</span>
																		{isActive && (
																			<span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
																				Active
																			</span>
																		)}
																	</div>
																	<p className="text-xs text-slate-500">
																		{formatRateDate(rate.start_date)} —{" "}
																		{rate.end_date
																			? formatRateDate(rate.end_date)
																			: "ongoing"}
																	</p>
																	{rate.custom_id && (
																		<p className="text-[11px] text-slate-500">
																			ID: {rate.custom_id}
																		</p>
																	)}
																</div>
																{canManage && (
																	<div className="flex items-center gap-1">
																		<button
																			type="button"
																			onClick={() => onEditRate(rate)}
																			disabled={isPending}
																			title="Edit rate"
																			className="rounded-md border border-slate-300 bg-white p-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
																		>
																			<Pencil className="h-3.5 w-3.5" />
																		</button>
																		<button
																			type="button"
																			onClick={() => onDeleteRate(rate)}
																			disabled={isPending}
																			title="Delete rate"
																			className="rounded-md border border-rose-200 bg-rose-50 p-1.5 text-rose-700 hover:bg-rose-100 disabled:opacity-50"
																		>
																			<Trash2 className="h-3.5 w-3.5" />
																		</button>
																	</div>
																)}
															</div>
														</li>
													);
												})}
											</ol>
										</div>
									))}
								</div>
							)}
						</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
		</MotionConfig>
	);
}
