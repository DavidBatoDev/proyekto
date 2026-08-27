import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CircleDollarSign, FileSignature } from "lucide-react";
import { useState } from "react";
import {
	AppEmptyState,
	AppSectionHeader,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import {
	FINANCE_CRUMB_LINK_CLASS,
	FinanceBreadcrumbs,
	FinanceCurrentCrumb,
} from "@/components/finance/portfolio/FinanceBreadcrumbs";
import { financeBooksService } from "@/services/financeBooks.service";

/**
 * The F1 creation wizard. Deliberately never blocked: a user with zero
 * contracts still creates their book and lands on empty states — contracts
 * unlock data (timer, payouts), not creation. Engaged projects are shown
 * read-only so the user sees what will feed the dashboard.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/setup/personal",
)({
	component: PersonalFinanceSetupPage,
});

const CURRENCIES = ["USD", "EUR", "GBP", "PHP", "AUD", "SGD", "CAD", "JPY"];

function PersonalFinanceSetupPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [currency, setCurrency] = useState("USD");

	const engagedQuery = useQuery({
		queryKey: ["finance-books", "engaged-projects"],
		queryFn: financeBooksService.engagedProjects,
	});

	const createMutation = useMutation({
		mutationFn: () => financeBooksService.createPersonal(currency),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["finance-books"] });
			void navigate({ to: "/engagements/finance/me" });
		},
	});

	return (
		<div className="app-shell-bg min-h-full px-5 py-4 md:px-8 md:py-5">
			<div className="mx-auto w-full max-w-3xl">
				<FinanceBreadcrumbs
					items={[
						<Link
							key="engagements"
							to="/engagements"
							className={FINANCE_CRUMB_LINK_CLASS}
						>
							Engagements
						</Link>,
						<Link
							key="finance"
							to="/engagements/finance"
							className={FINANCE_CRUMB_LINK_CLASS}
						>
							Finance
						</Link>,
						<FinanceCurrentCrumb key="setup">
							Set up my finance
						</FinanceCurrentCrumb>,
					]}
				/>

				<AppSectionHeader
					title="Set up my finance"
					subtitle="Your private finance book: hours worked, money in and out, payouts, and rates across your engaged projects. Only you can see it."
					className="mt-4"
				/>

				<AppSurfaceCard className="mt-5 p-5">
					<label
						htmlFor="finance-currency"
						className="text-sm font-semibold text-slate-900"
					>
						Display currency
					</label>
					<p className="mt-0.5 text-xs text-slate-500">
						Figures keep their native currency; this only sets how your
						dashboard groups and leads.
					</p>
					<select
						id="finance-currency"
						value={currency}
						onChange={(event) => setCurrency(event.target.value)}
						className="mt-3 w-40 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
					>
						{CURRENCIES.map((code) => (
							<option key={code} value={code}>
								{code}
							</option>
						))}
					</select>
				</AppSurfaceCard>

				<AppSectionHeader
					title="Engaged projects"
					subtitle="Signed contracts feed your book automatically — nothing to pick here."
					className="mt-8"
				/>
				{engagedQuery.isPending ? (
					<p className="mt-3 text-sm text-slate-500">
						Checking your contracts…
					</p>
				) : (engagedQuery.data?.length ?? 0) === 0 ? (
					<AppEmptyState
						icon={FileSignature}
						title="No signed contracts yet"
						description="You can still create your book now. When a team signs a contract with you, its project appears here and unlocks the execution timer and payouts."
						className="mt-3"
					/>
				) : (
					<div className="mt-3 space-y-3">
						{(engagedQuery.data ?? []).map((project) => (
							<AppSurfaceCard
								key={project.contract_id}
								className="flex items-center justify-between gap-4 px-5 py-4"
							>
								<p className="truncate text-sm font-semibold text-slate-900">
									{project.project_title}
								</p>
								<span className="shrink-0 text-xs font-medium text-slate-500 capitalize">
									{project.contract_status} · {project.currency}
								</span>
							</AppSurfaceCard>
						))}
					</div>
				)}

				{createMutation.isError ? (
					<p className="mt-4 text-sm font-medium text-red-600">
						{createMutation.error.message}
					</p>
				) : null}

				<div className="mt-6 flex items-center gap-3">
					<button
						type="button"
						disabled={createMutation.isPending}
						onClick={() => createMutation.mutate()}
						className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-60"
					>
						<CircleDollarSign className="h-4 w-4" />
						{createMutation.isPending ? "Creating…" : "Create my finance"}
					</button>
					<Link
						to="/engagements/finance"
						className="text-sm font-medium text-slate-600 hover:text-slate-900"
					>
						Cancel
					</Link>
				</div>
			</div>
		</div>
	);
}
