import { Handshake } from "lucide-react";
import {
	AppEmptyState,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { formatCurrency } from "@/lib/currency";
import type {
	Engagement,
	EngagementTimeRate,
} from "@/services/engagement.service";
import {
	FinanceLoading,
	FinanceSectionHeading,
	FinanceStatusBadge,
} from "./FinancePrimitives";

const RATE_UNIT_SUFFIX: Record<string, string> = {
	hour: "/hr",
	month: "/mo",
	fixed: " fixed",
};

function describeRate(rate: EngagementTimeRate): string {
	const amount = formatCurrency(rate.amount, rate.currency ?? "USD");
	return `${amount}${RATE_UNIT_SUFFIX[rate.unit] ?? ""}`;
}

function describeScope(engagement: Engagement): string {
	const active = engagement.project_links.filter(
		(link) => link.status !== "ended",
	);
	if (engagement.scope_mode === "flexible" && active.length === 0) {
		return "Flexible · no projects placed yet";
	}
	if (active.length === 0) return "No linked project";
	if (active.length === 1) return active[0].project_title_snapshot;
	return `${active.length} projects`;
}

export function EngagementPortfolio({
	loading,
	error,
	items,
	onOpenContract,
}: {
	loading: boolean;
	error: Error | null;
	items: Engagement[];
	onOpenContract: (contractId: string) => void;
}) {
	if (loading) return <FinanceLoading />;
	if (error) {
		return (
			<AppEmptyState
				icon={Handshake}
				title="Could not load engagements"
				description={error.message}
			/>
		);
	}
	if (!items.length) {
		return (
			<AppEmptyState
				icon={Handshake}
				title="No engagements yet"
				description="An engagement is created when both parties finish signing a contract. Sign a contract to start one."
			/>
		);
	}
	return (
		<div className="space-y-5 pb-8">
			<FinanceSectionHeading
				eyebrow="Commercial relationships"
				title="Engagements"
				description="Who hired whom, the projects each relationship covers, and the signed terms in effect today."
				count={`${items.length} ${items.length === 1 ? "engagement" : "engagements"}`}
			/>
			<AppSurfaceCard className="divide-y divide-border overflow-hidden">
				{items.map((engagement) => {
					const counterpartyName =
						engagement.counterparty?.display_name_snapshot ??
						engagement.counterparty?.email_snapshot ??
						"Counterparty removed";
					const isClientSide = engagement.kind === "client_services";
					const relationship =
						engagement.viewer_position === "hirer"
							? `You hired ${counterpartyName}`
							: `${counterpartyName} hired you`;
					return (
						<div
							key={engagement.id}
							className="flex w-full items-center justify-between gap-4 p-4 text-left md:px-5 md:py-4"
						>
							<span className="flex min-w-0 items-center gap-3">
								<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
									<Handshake className="h-5 w-5" />
								</span>
								<span className="min-w-0">
									<span className="block truncate font-semibold text-foreground">
										{relationship}
									</span>
									<span className="mt-1 block truncate text-xs text-muted-foreground">
										{isClientSide ? "Client engagement" : "Talent engagement"} ·{" "}
										{describeScope(engagement)}
									</span>
								</span>
							</span>
							<span className="flex shrink-0 items-center gap-3">
								{engagement.current_rates.length > 0 && (
									<span className="hidden text-xs font-medium text-muted-foreground sm:block">
										{engagement.current_rates.map(describeRate).join(" · ")}
									</span>
								)}
								<FinanceStatusBadge status={engagement.status} />
								{engagement.activated_by_contract_id && (
									<button
										type="button"
										onClick={() =>
											onOpenContract(
												engagement.activated_by_contract_id as string,
											)
										}
										className="text-xs font-semibold text-primary hover:underline"
									>
										Contract
									</button>
								)}
							</span>
						</div>
					);
				})}
			</AppSurfaceCard>
		</div>
	);
}
