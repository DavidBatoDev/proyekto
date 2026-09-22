import {
	BadgeCheck,
	ChevronLeft,
	ChevronRight,
	Loader2,
	Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AppConfirmDialog } from "@/components/common/AppConfirmDialog";
import {
	useAdminWorkspacesQuery,
	useClearWorkspaceCompMutation,
	useIsSuperAdmin,
} from "@/hooks/useAdminPlans";
import { useToast } from "@/hooks/useToast";
import { formatCount, type PlanId, planLabel } from "@/lib/planLimits";
import { compFallbackPlan, MAX_ADMIN_NOTE } from "@/lib/planLimitsAdmin";
import { COMPLIMENTARY_BADGE } from "@/lib/usageCopy";
import type {
	AdminWorkspaceFilter,
	AdminWorkspaceRow,
} from "@/services/admin.service";
import { CompPlanDialog } from "./CompPlanDialog";

/**
 * /admin/workspaces — every workspace's plan and usage, and complimentary
 * plans. Any admin can look (support needs to explain why a customer is
 * blocked); only a super admin sees the comp actions.
 */

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

const FILTERS: Array<{ value: AdminWorkspaceFilter; label: string }> = [
	{ value: "all", label: "All" },
	{ value: "comped", label: "Complimentary" },
	{ value: "paid", label: "Paid" },
	{ value: "free", label: "Free" },
];

const COUNT_COLUMNS = [
	{ key: "members", label: "Members" },
	{ key: "projects", label: "Projects" },
	{ key: "teams", label: "Teams" },
] as const;

function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(timer);
	}, [value, delayMs]);
	return debounced;
}

function formatDate(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime())
		? ""
		: date.toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
				year: "numeric",
			});
}

function PlanBadge({ plan }: { plan: PlanId }) {
	return (
		<span
			className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
				plan === "free"
					? "bg-muted text-muted-foreground"
					: "bg-primary/10 text-primary"
			}`}
		>
			{planLabel(plan)}
		</span>
	);
}

function PlanCell({ row }: { row: AdminWorkspaceRow }) {
	const comp = row.complimentary;
	const billingDiffers = row.subscription.plan !== row.effective_plan;
	const status = row.subscription.status;
	return (
		<div className="space-y-1">
			<div className="flex flex-wrap items-center gap-1.5">
				<PlanBadge plan={row.effective_plan} />
				{comp?.active ? (
					<span
						className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground"
						title={
							row.plan_source === "complimentary"
								? undefined
								: `Comped ${planLabel(comp.plan)}; their subscription outranks it.`
						}
					>
						<BadgeCheck className="h-3 w-3 text-success" />
						{COMPLIMENTARY_BADGE}
						{row.plan_source === "complimentary"
							? ""
							: ` ${planLabel(comp.plan)}`}
					</span>
				) : comp ? (
					<span className="inline-flex rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
						Comp ended
					</span>
				) : null}
			</div>
			{comp?.until ? (
				<p className="text-[11px] text-muted-foreground">
					{comp.active ? "Until" : "Ended"} {formatDate(comp.until)}
				</p>
			) : null}
			{billingDiffers ? (
				<p className="text-[11px] text-muted-foreground">
					billing: {planLabel(row.subscription.plan)}
					{status && status !== "active" ? ` (${status})` : ""}
				</p>
			) : null}
		</div>
	);
}

export function AdminWorkspacesPage() {
	const canComp = useIsSuperAdmin();
	const toast = useToast();

	const [search, setSearch] = useState("");
	const [filter, setFilter] = useState<AdminWorkspaceFilter>("all");
	const debouncedSearch = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);

	// The page belongs to one search + filter; a new one starts from page 1
	// without a render (and a fetch) spent on the old page number.
	const listKey = `${filter}|${debouncedSearch}`;
	const [paging, setPaging] = useState({ key: listKey, page: 1 });
	const page = paging.key === listKey ? paging.page : 1;
	const goToPage = (next: number) =>
		setPaging({ key: listKey, page: Math.max(1, next) });

	const query = useAdminWorkspacesQuery({
		search: debouncedSearch || undefined,
		filter,
		page,
		page_size: PAGE_SIZE,
	});

	const [compTarget, setCompTarget] = useState<AdminWorkspaceRow | null>(null);
	const [removeTarget, setRemoveTarget] = useState<AdminWorkspaceRow | null>(
		null,
	);
	const [removeNote, setRemoveNote] = useState("");
	const clearComp = useClearWorkspaceCompMutation();

	const data = query.data;
	const rows = data?.items ?? [];
	const total = data?.total ?? 0;
	const pageSize = data?.page_size ?? PAGE_SIZE;
	const currentPage = data?.page ?? page;
	const firstShown = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
	const lastShown = Math.min(total, (currentPage - 1) * pageSize + rows.length);
	const hasNext = currentPage * pageSize < total;

	const confirmRemove = () => {
		if (!removeTarget) return;
		clearComp.mutate(
			{ workspaceId: removeTarget.id, note: removeNote },
			{
				onSuccess: () => {
					toast.success(`Removed ${removeTarget.name}'s complimentary plan.`);
					setRemoveTarget(null);
					setRemoveNote("");
				},
				onError: (err) => {
					toast.error(
						err instanceof Error && err.message
							? err.message
							: "Couldn't remove the complimentary plan.",
					);
				},
			},
		);
	};

	return (
		<div className="h-full overflow-auto bg-background">
			<div className="px-4 py-6 sm:px-8 sm:py-8">
				<div className="mb-6">
					<h1 className="text-2xl font-bold text-foreground">Workspaces</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						Every workspace's plan and usage. Counts over the plan's limit are
						highlighted; they are grandfathered, so nothing is lost, but they
						can't grow.
					</p>
				</div>

				<div className="mb-4 flex flex-wrap items-center gap-3">
					<div className="relative w-full max-w-sm">
						<Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<input
							type="search"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search name, slug or owner email"
							aria-label="Search workspaces"
							maxLength={100}
							className="w-full rounded-xl border border-input bg-card py-2 pr-3 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
						/>
					</div>
					<div
						role="group"
						aria-label="Filter workspaces"
						className="flex flex-wrap gap-1.5"
					>
						{FILTERS.map((option) => (
							<button
								key={option.value}
								type="button"
								aria-pressed={filter === option.value}
								onClick={() => setFilter(option.value)}
								className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
									filter === option.value
										? "bg-primary text-primary-foreground"
										: "border border-border bg-card text-muted-foreground hover:bg-muted"
								}`}
							>
								{option.label}
							</button>
						))}
					</div>
					{query.isFetching && !query.isLoading ? (
						<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
					) : null}
				</div>

				{query.isLoading ? (
					<div className="flex items-center justify-center py-24">
						<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				) : query.isError ? (
					<div className="rounded-2xl border border-border bg-card p-8 text-center">
						<p className="text-sm text-muted-foreground">
							{query.error instanceof Error && query.error.message
								? query.error.message
								: "Couldn't load workspaces."}
						</p>
						<button
							type="button"
							onClick={() => void query.refetch()}
							className="mt-4 rounded-xl border border-input px-4 py-2 text-sm text-foreground transition hover:bg-muted"
						>
							Try again
						</button>
					</div>
				) : (
					<div className="overflow-x-auto rounded-2xl border border-border bg-card">
						<table className="w-full min-w-[820px] border-collapse text-sm">
							<thead>
								<tr className="border-b border-border text-left text-xs font-semibold text-muted-foreground">
									<th scope="col" className="px-4 py-3">
										Workspace
									</th>
									<th scope="col" className="px-3 py-3">
										Plan
									</th>
									{COUNT_COLUMNS.map((column) => (
										<th
											key={column.key}
											scope="col"
											className="px-3 py-3 text-right"
										>
											{column.label}
										</th>
									))}
									{canComp ? (
										<th scope="col" className="px-4 py-3 text-right">
											Actions
										</th>
									) : null}
								</tr>
							</thead>
							<tbody>
								{rows.length === 0 ? (
									<tr>
										<td
											colSpan={canComp ? 6 : 5}
											className="px-4 py-12 text-center text-sm text-muted-foreground"
										>
											No workspaces match.
										</td>
									</tr>
								) : (
									rows.map((row) => (
										<tr
											key={row.id}
											className="border-b border-border align-top last:border-b-0"
										>
											<td className="px-4 py-3">
												<p className="font-medium text-foreground">
													{row.name}
												</p>
												<p className="text-xs text-muted-foreground">
													{row.slug}
												</p>
												{row.owner?.email ? (
													<p className="text-xs text-muted-foreground">
														{row.owner.email}
													</p>
												) : null}
											</td>
											<td className="px-3 py-3">
												<PlanCell row={row} />
											</td>
											{COUNT_COLUMNS.map((column) => {
												const over = row.over_limit.includes(column.key);
												return (
													<td
														key={column.key}
														className="px-3 py-3 text-right tabular-nums"
													>
														<span
															className={
																over
																	? "font-semibold text-destructive"
																	: "text-foreground"
															}
															title={
																over
																	? `Over the ${planLabel(row.effective_plan)} limit`
																	: undefined
															}
															data-over-limit={over || undefined}
														>
															{formatCount(row[column.key])}
														</span>
														{column.key === "members" &&
														row.pending_invites > 0 ? (
															<span className="block text-[11px] text-muted-foreground">
																+{formatCount(row.pending_invites)} invited
															</span>
														) : null}
													</td>
												);
											})}
											{canComp ? (
												<td className="px-4 py-3 text-right">
													{row.complimentary ? (
														<div className="flex justify-end gap-1.5">
															<button
																type="button"
																onClick={() => setCompTarget(row)}
																className="rounded-lg border border-input px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-muted"
															>
																Edit comp
															</button>
															<button
																type="button"
																onClick={() => {
																	setRemoveNote("");
																	setRemoveTarget(row);
																}}
																className="rounded-lg border border-destructive/40 px-2.5 py-1 text-xs font-medium text-destructive transition hover:bg-destructive/10"
															>
																Remove comp
															</button>
														</div>
													) : (
														<button
															type="button"
															onClick={() => setCompTarget(row)}
															className="rounded-lg border border-input px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-muted"
														>
															Comp plan…
														</button>
													)}
												</td>
											) : null}
										</tr>
									))
								)}
							</tbody>
						</table>
					</div>
				)}

				{total > 0 ? (
					<div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
						<span>
							{formatCount(firstShown)}–{formatCount(lastShown)} of{" "}
							{formatCount(total)}
						</span>
						<div className="flex gap-1.5">
							<button
								type="button"
								onClick={() => goToPage(currentPage - 1)}
								disabled={currentPage <= 1 || query.isFetching}
								aria-label="Previous page"
								className="rounded-lg border border-input p-1.5 text-foreground transition hover:bg-muted disabled:opacity-40"
							>
								<ChevronLeft className="h-4 w-4" />
							</button>
							<button
								type="button"
								onClick={() => goToPage(currentPage + 1)}
								disabled={!hasNext || query.isFetching}
								aria-label="Next page"
								className="rounded-lg border border-input p-1.5 text-foreground transition hover:bg-muted disabled:opacity-40"
							>
								<ChevronRight className="h-4 w-4" />
							</button>
						</div>
					</div>
				) : null}
			</div>

			{canComp ? (
				<>
					<CompPlanDialog
						open={!!compTarget}
						workspace={compTarget}
						onClose={() => setCompTarget(null)}
					/>
					<AppConfirmDialog
						open={!!removeTarget}
						title={
							removeTarget
								? `Remove ${removeTarget.name}'s complimentary plan?`
								: "Remove complimentary plan?"
						}
						tone="danger"
						confirmLabel="Remove comp"
						busy={clearComp.isPending}
						onConfirm={confirmRemove}
						onClose={() => {
							if (!clearComp.isPending) setRemoveTarget(null);
						}}
						message={
							removeTarget ? (
								<div className="space-y-3">
									<p className="text-sm leading-relaxed text-muted-foreground">
										Falls back to{" "}
										{planLabel(compFallbackPlan(removeTarget.subscription))}.
										Nothing is deleted; anything over its limits stays but can't
										grow.
									</p>
									<div>
										<label
											htmlFor="comp-remove-note"
											className="text-xs font-semibold text-foreground"
										>
											Note (optional)
										</label>
										<textarea
											id="comp-remove-note"
											value={removeNote}
											maxLength={MAX_ADMIN_NOTE}
											onChange={(e) => setRemoveNote(e.target.value)}
											rows={2}
											className="mt-1 w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
										/>
									</div>
								</div>
							) : null
						}
					/>
				</>
			) : null}
		</div>
	);
}
