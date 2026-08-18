import { CircleDollarSign } from "lucide-react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import { formatCurrency } from "@/lib/currency";
import type { FinancePortfolio } from "@/services/finance.service";
import {
	FinanceLoading,
	FinanceSectionHeading,
	FinanceStatusBadge,
	NoFinanceData,
} from "./FinancePrimitives";

export function PortfolioOverview({
	loading,
	portfolio,
	onOpen,
}: {
	loading: boolean;
	portfolio?: FinancePortfolio;
	onOpen: (projectId: string) => void;
}) {
	if (loading) return <FinanceLoading />;
	if (!portfolio?.projects.length) return <NoFinanceData />;
	return (
		<div className="space-y-5 pb-8">
			<FinanceSectionHeading
				eyebrow="Portfolio overview"
				title="Project performance"
				description="Compare billed revenue, delivery cost, and margin without mixing currencies."
				count={`${portfolio.projects.length} ${portfolio.projects.length === 1 ? "project" : "projects"}`}
			/>
			<div className="grid gap-4 lg:grid-cols-2">
				{portfolio.totals_by_currency.map((total) => (
					<AppSurfaceCard key={total.currency} className="overflow-hidden p-5">
						<div className="flex items-start justify-between gap-4">
							<div>
								<p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
									{total.currency} portfolio margin
								</p>
								<p className="mt-2 text-2xl font-bold tracking-tight text-foreground tabular-nums">
									{formatCurrency(total.margin, total.currency)}
								</p>
							</div>
							<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
								<CircleDollarSign className="h-5 w-5" />
							</span>
						</div>
						<div className="mt-5 grid grid-cols-2 gap-4 border-t border-border/70 pt-4 sm:grid-cols-4">
							<div>
								<p className="text-xs text-muted-foreground">Billed</p>
								<p className="mt-1 font-semibold text-foreground tabular-nums">
									{formatCurrency(total.revenue, total.currency)}
								</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">Collected</p>
								<p className="mt-1 font-semibold text-foreground tabular-nums">
									{formatCurrency(total.collected, total.currency)}
								</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">Outstanding</p>
								<p className="mt-1 font-semibold text-foreground tabular-nums">
									{formatCurrency(total.outstanding, total.currency)}
								</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">Delivery cost</p>
								<p className="mt-1 font-semibold text-foreground tabular-nums">
									{formatCurrency(total.cost, total.currency)}
								</p>
							</div>
						</div>
						<p className="mt-4 text-xs text-muted-foreground">
							{total.project_count}{" "}
							{total.project_count === 1 ? "project" : "projects"} ·{" "}
							{total.invoice_count}{" "}
							{total.invoice_count === 1 ? "invoice" : "invoices"}
						</p>
					</AppSurfaceCard>
				))}
			</div>
			<AppSurfaceCard className="overflow-hidden">
				<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-4">
					<div>
						<h3 className="font-semibold text-foreground">Projects</h3>
						<p className="mt-0.5 text-xs text-muted-foreground">
							Select a row to open its financial workspace
						</p>
					</div>
					<span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
						{portfolio.projects.length} total
					</span>
				</div>
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm">
						<thead className="border-b border-border bg-muted/50 text-xs uppercase text-muted-foreground">
							<tr>
								<th className="px-4 py-3">Project</th>
								<th className="px-4 py-3">Revenue</th>
								<th className="px-4 py-3">Cost</th>
								<th className="px-4 py-3">Margin</th>
								<th className="px-4 py-3">Contract</th>
							</tr>
						</thead>
						<tbody>
							{portfolio.projects.map((project) => (
								<tr
									key={project.id}
									className="cursor-pointer border-b border-border/70 hover:bg-muted/40"
									onClick={() => onOpen(project.id)}
								>
									<td className="px-4 py-3">
										<p className="font-semibold text-foreground">
											{project.title}
										</p>
										<p className="text-xs capitalize text-muted-foreground">
											{project.status}
										</p>
									</td>
									<td className="px-4 py-3 tabular-nums">
										{formatCurrency(project.revenue, project.currency)}
									</td>
									<td className="px-4 py-3 tabular-nums">
										{formatCurrency(project.cost, project.currency)}
									</td>
									<td className="px-4 py-3 font-semibold tabular-nums">
										{formatCurrency(project.margin, project.currency)}
									</td>
									<td className="px-4 py-3">
										{project.latest_contract ? (
											<FinanceStatusBadge
												status={project.latest_contract.status}
											/>
										) : (
											<span className="text-muted-foreground">Not created</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</AppSurfaceCard>
		</div>
	);
}
