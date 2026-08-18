import { ChevronRight, Handshake } from "lucide-react";
import {
	AppEmptyState,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import type { Engagement } from "@/services/engagement.service";
import {
	describeRate,
	describeRelationship,
	describeScope,
} from "./engagementCopy";
import {
	countLabel,
	FinanceLoading,
	FinanceSectionHeading,
	FinanceStatusBadge,
} from "./FinancePrimitives";

export function EngagementPortfolio({
	loading,
	error,
	items,
	filtered,
	onClearProject,
	onOpen,
}: {
	loading: boolean;
	error: Error | null;
	items: Engagement[];
	/** True when a project filter is narrowing the list. */
	filtered: boolean;
	onClearProject: () => void;
	onOpen: (engagementId: string) => void;
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

	return (
		<div className="space-y-4 pb-8">
			<FinanceSectionHeading
				eyebrow="Commercial relationships"
				title="Engagements"
				description="Who hired whom, the projects each relationship covers, and the signed terms in effect today."
				count={countLabel(items.length, "engagement")}
			/>
			<AppSurfaceCard className="divide-y divide-border overflow-hidden">
				{items.map((engagement) => (
					<EngagementRow
						key={engagement.id}
						engagement={engagement}
						onOpen={onOpen}
					/>
				))}
			</AppSurfaceCard>
		</div>
	);
}

function EngagementRow({
	engagement,
	onOpen,
}: {
	engagement: Engagement;
	onOpen: (engagementId: string) => void;
}) {
	const isClientSide = engagement.kind === "client_services";
	return (
		<button
			type="button"
			onClick={() => onOpen(engagement.id)}
			className="group flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-muted/40 md:px-5 md:py-4"
		>
			<span className="flex min-w-0 items-center gap-3">
				<span
					className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isClientSide ? "bg-primary/10 text-primary" : "bg-info/10 text-info-foreground"}`}
				>
					<Handshake className="h-5 w-5" />
				</span>
				<span className="min-w-0">
					<span className="block truncate font-semibold text-foreground">
						{describeRelationship(engagement)}
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
				<ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
			</span>
		</button>
	);
}
