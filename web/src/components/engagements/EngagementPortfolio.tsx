import { ChevronRight, FileSignature, Handshake } from "lucide-react";
import {
	AppEmptyState,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { InitialsTile } from "@/components/finance/InitialsTile";
import {
	FinanceLoading,
	FinanceStatusBadge,
} from "@/components/finance/portfolio/FinancePrimitives";
import type {
	Engagement,
	EngagementAgreement,
} from "@/services/engagement.service";
import {
	describeRate,
	describeRelationship,
	describeScope,
} from "./engagementCopy";

export function EngagementPortfolio({
	loading,
	error,
	items,
	filtered,
	onClearProject,
	onOpen,
	agreementsByContractId,
}: {
	loading: boolean;
	error: Error | null;
	items: Engagement[];
	/** True when a project filter is narrowing the list. */
	filtered: boolean;
	onClearProject: () => void;
	onOpen: (engagementId: string) => void;
	/**
	 * The viewer's contract seats keyed by contract id, so each row can show
	 * the paper behind it inline instead of the page keeping a separate
	 * agreements list. Optional — rows render without it.
	 */
	agreementsByContractId?: Map<string, EngagementAgreement>;
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
		/*
		 * A flexible engagement is meant to collect `operational_assignment`
		 * project links as work is placed against it, and nothing writes those
		 * yet — `engagement_assignments` has no writer. So a project filter can
		 * never match a flexible engagement, and reporting that as "none on this
		 * project" implies the relationship is missing when it is simply not yet
		 * attributable to a project.
		 */
		if (filtered) {
			return (
				<AppEmptyState
					icon={Handshake}
					title="No engagement is placed on this project yet"
					description="These relationships are flexible: they cover the parties rather than one project, and are attributed to projects only once work is placed against them. Clear the filter to see them all."
					action={
						<button
							type="button"
							onClick={onClearProject}
							className="app-cta inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white"
						>
							Show all engagements
						</button>
					}
				/>
			);
		}
		return (
			<AppEmptyState
				icon={Handshake}
				title="No engagements yet"
				description="An engagement opens when both parties sign a contract that names them. Agreements signed before party seats existed stay valid but do not open one — amend such a contract to bring it across."
			/>
		);
	}

	// The page owns its heading and count — this component is just the list,
	// so it can sit under whatever chrome the page builds around it.
	return (
		<div className="space-y-4 pb-8">
			<AppSurfaceCard className="divide-y divide-border overflow-hidden">
				{items.map((engagement) => (
					<EngagementRow
						key={engagement.id}
						engagement={engagement}
						onOpen={onOpen}
						agreement={
							engagement.activated_by_contract_id
								? agreementsByContractId?.get(
										engagement.activated_by_contract_id,
									)
								: undefined
						}
					/>
				))}
			</AppSurfaceCard>
		</div>
	);
}

function EngagementRow({
	engagement,
	onOpen,
	agreement,
}: {
	engagement: Engagement;
	onOpen: (engagementId: string) => void;
	agreement?: EngagementAgreement;
}) {
	const counterparty =
		engagement.counterparty?.display_name_snapshot ??
		engagement.counterparty?.email_snapshot ??
		null;
	const signed = agreement?.signed_at
		? new Date(agreement.signed_at).toLocaleDateString(undefined, {
				month: "short",
				day: "numeric",
				year: "numeric",
			})
		: null;
	return (
		<button
			type="button"
			onClick={() => onOpen(engagement.id)}
			className="group flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-muted/40 md:px-5 md:py-4"
		>
			<span className="flex min-w-0 items-center gap-3">
				{/*
				 * The list is scanned by WHO, so the row leads with the counterparty
				 * rather than a handshake that is identical on every line. A removed
				 * counterparty has no name to abbreviate and keeps the icon.
				 */}
				{counterparty ? (
					<InitialsTile name={counterparty} shape="round" />
				) : (
					<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
						<Handshake className="h-5 w-5" />
					</span>
				)}
				<span className="min-w-0">
					<span className="flex min-w-0 items-center gap-2">
						<span className="truncate font-semibold text-foreground">
							{describeRelationship(engagement)}
						</span>
						{/*
						 * The COUNTERPARTY's capacity, not the engagement's kind: to the
						 * client on a client engagement the other seat is a consultant,
						 * and "You hired Dev Consultant · Client" would be backwards.
						 */}
						{engagement.counterparty?.capacity ? (
							<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground capitalize">
								{engagement.counterparty.capacity}
							</span>
						) : null}
					</span>
					<span className="mt-1 block truncate text-xs text-muted-foreground">
						{describeScope(engagement)}
					</span>
					{agreement && (
						<span className="mt-1 flex items-center gap-1.5 truncate text-xs font-medium text-primary">
							<FileSignature className="h-3 w-3 shrink-0" />
							{agreement.contract_number ?? "Contract"}
							{signed ? ` · signed ${signed}` : ""}
						</span>
					)}
				</span>
			</span>
			<span className="flex shrink-0 items-center gap-3">
				{engagement.current_rates.length > 0 && (
					<span className="hidden text-xs font-medium text-muted-foreground sm:block">
						{engagement.current_rates.map(describeRate).join(" · ")}
					</span>
				)}
				<FinanceStatusBadge status={engagement.status} />
				<ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
			</span>
		</button>
	);
}
