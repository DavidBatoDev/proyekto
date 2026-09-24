import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Repeat, TrendingDown, XCircle } from "lucide-react";
import { useState } from "react";
import {
	AppPrimaryButton,
	AppSecondaryButton,
} from "@/components/common/AppButton";
import { AppDialog } from "@/components/common/AppDialog";
import {
	AppEmptyState,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { AppTabs } from "@/components/common/AppTabs";
import { CurrencySelect } from "@/components/common/CurrencySelect";
import { DateField } from "@/components/common/DateField";
import { SelectField, TextField } from "@/components/common/FormFields";
import { useHubTeam } from "@/components/finance/nav/useManagedTeams";
import { FinanceLoading } from "@/components/finance/portfolio/FinancePrimitives";
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";
import { DEFAULT_CURRENCY, formatCurrency } from "@/lib/currency";
import {
	EXPENSE_CATEGORY_LABELS,
	type ExpenseCategory,
	type ExpenseInput,
	type ExpenseRecurrence,
	type FinanceExpense,
	financeExpensesService,
} from "@/services/financeExpenses.service";
import { listTeamProjects } from "@/services/teams.service";

type Window = "month" | "year" | "all";

const WINDOWS: Array<{ key: Window; label: string }> = [
	{ key: "month", label: "This month" },
	{ key: "year", label: "This year" },
	{ key: "all", label: "All time" },
];

function isoDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function windowRange(window: Window): { from?: string; to?: string } {
	const now = new Date();
	if (window === "month") {
		return {
			from: isoDate(new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))),
			to: isoDate(now),
		};
	}
	if (window === "year") {
		return {
			from: isoDate(new Date(Date.UTC(now.getFullYear(), 0, 1))),
			to: isoDate(now),
		};
	}
	return {};
}

/**
 * Money out for one team (or one project of it): the manual expense ledger
 * plus recorded payouts, which count as salary automatically. Owners,
 * managers, and accountants record entries; everyone who can see costs reads
 * them. Amounts are never summed across currencies.
 */
export function ExpensesPanel({
	teamId,
	projectId,
}: {
	teamId: string;
	/** Narrow the ledger to one project (the project finance page). */
	projectId?: string;
}) {
	const [window, setWindow] = useState<Window>("month");
	const [editing, setEditing] = useState<FinanceExpense | "new" | null>(null);
	const qc = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();

	const range = windowRange(window);
	const expensesQuery = useQuery({
		queryKey: ["finance-expenses", teamId, projectId, window],
		queryFn: () =>
			financeExpensesService.list(teamId, { ...range, project_id: projectId }),
	});

	const voidMutation = useMutation({
		mutationFn: (expenseId: string) => financeExpensesService.void(expenseId),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["finance-expenses"] });
			void qc.invalidateQueries({ queryKey: ["finance-books", "me-summary"] });
			toast.success("Expense voided");
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const data = expensesQuery.data;
	const canManage = data?.can_manage ?? false;
	const expenses = (data?.expenses ?? []).filter((row) => !row.voided_at);

	return (
		<div className="space-y-6 pb-8">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<AppTabs
					variant="pill"
					size="sm"
					items={WINDOWS.map((entry) => ({
						key: entry.key,
						label: entry.label,
					}))}
					active={window}
					onChange={setWindow}
				/>
				{canManage ? (
					<button
						type="button"
						onClick={() => setEditing("new")}
						className="app-cta inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white"
					>
						<Plus className="h-4 w-4" />
						Add expense
					</button>
				) : null}
			</div>

			{expensesQuery.isPending ? (
				<FinanceLoading />
			) : expensesQuery.isError ? (
				<AppEmptyState
					icon={TrendingDown}
					title="Could not load expenses"
					description={expensesQuery.error.message}
				/>
			) : (
				<>
					{(data?.summary ?? []).length > 0 ? (
						<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
							{(data?.summary ?? []).map((row) => (
								<AppSurfaceCard key={row.currency} className="px-5 py-4">
									<p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
										Money out · {row.currency}
									</p>
									<p className="mt-1.5 text-2xl font-bold tracking-tight text-foreground">
										{formatCurrency(row.total, row.currency)}
									</p>
									<p className="mt-1 text-xs text-muted-foreground">
										{formatCurrency(row.payouts_total, row.currency)} payouts ·{" "}
										{formatCurrency(row.expenses_total, row.currency)} expenses
									</p>
									<CategoryBars
										currency={row.currency}
										total={row.total}
										byCategory={row.by_category}
									/>
								</AppSurfaceCard>
							))}
						</div>
					) : null}

					{expenses.length === 0 ? (
						<AppEmptyState
							icon={TrendingDown}
							title="No expenses recorded"
							description={
								canManage
									? "Record what the team spends outside payouts — contractors, software, subscriptions, overhead, taxes. Recurring costs only need entering once."
									: "Expenses the team records will appear here."
							}
						/>
					) : (
						<AppSurfaceCard className="divide-y divide-border/60 overflow-hidden">
							{expenses.map((expense) => (
								<div
									key={expense.id}
									className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
								>
									<div className="min-w-0">
										<p className="flex items-center gap-2 truncate text-sm font-semibold text-foreground">
											{expense.description}
											{expense.recurrence !== "none" ? (
												<span className="inline-flex items-center gap-1 rounded-full bg-info/10 px-2 py-0.5 text-[11px] font-semibold text-info-foreground">
													<Repeat className="h-3 w-3" />
													{expense.recurrence === "monthly"
														? "Monthly"
														: "Yearly"}
												</span>
											) : null}
										</p>
										<p className="mt-0.5 truncate text-xs text-muted-foreground">
											{EXPENSE_CATEGORY_LABELS[expense.category]}
											{expense.vendor ? ` · ${expense.vendor}` : ""} ·{" "}
											{new Date(
												`${expense.incurred_on}T12:00:00Z`,
											).toLocaleDateString()}
											{expense.recurrence_ends_on
												? ` → ${new Date(`${expense.recurrence_ends_on}T12:00:00Z`).toLocaleDateString()}`
												: ""}
										</p>
									</div>
									<div className="flex shrink-0 items-center gap-2">
										<span className="text-sm font-semibold tabular-nums text-foreground">
											{formatCurrency(expense.amount, expense.currency)}
										</span>
										{canManage ? (
											<>
												<button
													type="button"
													onClick={() => setEditing(expense)}
													aria-label="Edit expense"
													className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
												>
													<Pencil className="h-4 w-4" />
												</button>
												<button
													type="button"
													aria-label="Void expense"
													onClick={async () => {
														const ok = await confirm({
															title: "Void this expense?",
															message:
																"It stops counting toward money out. The record is kept for the audit trail.",
															confirmLabel: "Void",
															tone: "danger",
														});
														if (ok) voidMutation.mutate(expense.id);
													}}
													className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
												>
													<XCircle className="h-4 w-4" />
												</button>
											</>
										) : null}
									</div>
								</div>
							))}
						</AppSurfaceCard>
					)}
				</>
			)}

			{editing ? (
				<ExpenseDialog
					teamId={teamId}
					projectId={projectId}
					expense={editing === "new" ? null : editing}
					onClose={() => setEditing(null)}
				/>
			) : null}
		</div>
	);
}

function CategoryBars({
	currency,
	total,
	byCategory,
}: {
	currency: string;
	total: number;
	byCategory: Partial<Record<ExpenseCategory, number>>;
}) {
	const rows = (Object.entries(byCategory) as Array<[ExpenseCategory, number]>)
		.filter(([, amount]) => amount > 0)
		.sort((a, b) => b[1] - a[1]);
	if (rows.length === 0 || total <= 0) return null;
	return (
		<div className="mt-3 space-y-1.5">
			{rows.map(([category, amount]) => (
				<div key={category}>
					<div className="flex justify-between text-[11px] text-muted-foreground">
						<span>{EXPENSE_CATEGORY_LABELS[category]}</span>
						<span className="tabular-nums">
							{formatCurrency(amount, currency)}
						</span>
					</div>
					<div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
						<div
							className="h-full rounded-full bg-primary/70"
							style={{ width: `${Math.max(2, (amount / total) * 100)}%` }}
						/>
					</div>
				</div>
			))}
		</div>
	);
}

const CATEGORY_OPTIONS = (
	Object.entries(EXPENSE_CATEGORY_LABELS) as Array<[ExpenseCategory, string]>
).map(([value, label]) => ({ value, label }));

const RECURRENCE_OPTIONS: Array<{ value: ExpenseRecurrence; label: string }> = [
	{ value: "none", label: "One-off" },
	{ value: "monthly", label: "Every month" },
	{ value: "yearly", label: "Every year" },
];

function ExpenseDialog({
	teamId,
	projectId,
	expense,
	onClose,
}: {
	teamId: string;
	projectId?: string;
	expense: FinanceExpense | null;
	onClose: () => void;
}) {
	const qc = useQueryClient();
	const toast = useToast();
	// New entries start in the team's finance currency, not a global default.
	const { team } = useHubTeam(teamId);
	const defaultCurrency = team?.book?.currency ?? DEFAULT_CURRENCY;
	const [form, setForm] = useState({
		category: expense?.category ?? ("software_subscription" as ExpenseCategory),
		description: expense?.description ?? "",
		vendor: expense?.vendor ?? "",
		amount: expense ? String(expense.amount) : "",
		currency: expense?.currency ?? defaultCurrency,
		incurred_on: expense?.incurred_on ?? isoDate(new Date()),
		recurrence: expense?.recurrence ?? ("none" as ExpenseRecurrence),
		recurrence_ends_on: expense?.recurrence_ends_on ?? "",
		project_id: expense?.project_id ?? projectId ?? "",
	});
	const set = (patch: Partial<typeof form>) =>
		setForm((prev) => ({ ...prev, ...patch }));

	// Project attribution is optional and only offered on the team ledger.
	const projectsQuery = useQuery({
		queryKey: ["teams", teamId, "projects"],
		queryFn: () => listTeamProjects(teamId),
		enabled: !projectId,
	});

	const amount = Number(form.amount);
	const valid =
		form.description.trim().length > 0 &&
		Number.isFinite(amount) &&
		amount > 0 &&
		Boolean(form.incurred_on);

	const saveMutation = useMutation({
		mutationFn: () => {
			const input: ExpenseInput = {
				category: form.category,
				description: form.description.trim(),
				vendor: form.vendor.trim() || null,
				amount,
				currency: form.currency,
				incurred_on: form.incurred_on,
				recurrence: form.recurrence,
				recurrence_ends_on:
					form.recurrence === "none" ? null : form.recurrence_ends_on || null,
				project_id: form.project_id || null,
			};
			return expense
				? financeExpensesService.update(expense.id, input)
				: financeExpensesService.create(teamId, input);
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["finance-expenses"] });
			void qc.invalidateQueries({ queryKey: ["finance-books", "me-summary"] });
			toast.success(expense ? "Expense updated" : "Expense recorded");
			onClose();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	return (
		<AppDialog
			open
			onClose={onClose}
			title={expense ? "Edit expense" : "Add expense"}
			size="md"
			footer={
				<div className="flex w-full justify-end gap-2">
					<AppSecondaryButton onClick={onClose}>Cancel</AppSecondaryButton>
					<AppPrimaryButton
						onClick={() => saveMutation.mutate()}
						disabled={!valid}
						loading={saveMutation.isPending}
					>
						{expense ? "Save" : "Record expense"}
					</AppPrimaryButton>
				</div>
			}
		>
			<div className="space-y-4">
				<TextField
					label="Description"
					value={form.description}
					onChange={(description) => set({ description })}
					placeholder="e.g. Figma team plan"
				/>
				<div className="grid gap-4 sm:grid-cols-2">
					<SelectField
						label="Category"
						value={form.category}
						onChange={(value) => set({ category: value as ExpenseCategory })}
						options={CATEGORY_OPTIONS}
					/>
					<TextField
						label="Vendor"
						optional
						value={form.vendor}
						onChange={(vendor) => set({ vendor })}
					/>
				</div>
				<div className="grid gap-4 sm:grid-cols-2">
					<TextField
						label="Amount"
						type="number"
						value={form.amount}
						onChange={(value) => set({ amount: value })}
					/>
					<CurrencySelect
						label="Currency"
						value={form.currency}
						onChange={(currency) => set({ currency })}
					/>
				</div>
				<div className="grid gap-4 sm:grid-cols-2">
					<DateField
						label="Date"
						value={form.incurred_on}
						onChange={(incurred_on) => set({ incurred_on })}
					/>
					<SelectField
						label="Repeats"
						value={form.recurrence}
						onChange={(value) =>
							set({ recurrence: value as ExpenseRecurrence })
						}
						options={RECURRENCE_OPTIONS}
					/>
				</div>
				{form.recurrence !== "none" ? (
					<DateField
						label="Ends on (optional)"
						value={form.recurrence_ends_on}
						onChange={(recurrence_ends_on) => set({ recurrence_ends_on })}
						hint="Leave empty while the cost keeps recurring."
					/>
				) : null}
				{!projectId ? (
					<SelectField
						label="Project (optional)"
						value={form.project_id}
						onChange={(project_id) => set({ project_id })}
						options={[
							{ value: "", label: "Whole team" },
							...(projectsQuery.data ?? []).map((attachment) => ({
								value: attachment.project_id,
								label: attachment.project?.title ?? "Untitled project",
							})),
						]}
					/>
				) : null}
			</div>
		</AppDialog>
	);
}
