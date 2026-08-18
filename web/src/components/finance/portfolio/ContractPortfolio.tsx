import {
	ChevronRight,
	FileSignature,
	Handshake,
	Plus,
	Unlink,
} from "lucide-react";
import {
	AppEmptyState,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { formatCurrency } from "@/lib/currency";
import type { FinanceContractSummary } from "@/services/finance.service";
import {
	countLabel,
	FinanceLoading,
	FinancePager,
	FinanceSectionHeading,
	FinanceStatusBadge,
	formatFinanceDate,
} from "./FinancePrimitives";

export function ContractPortfolio({
	loading,
	items,
	total,
	page,
	limit,
	onPageChange,
	onOpen,
	onAddContract,
	projectId,
	filtered,
	onClearProject,
}: {
	loading: boolean;
	items: FinanceContractSummary[];
	total: number;
	page: number;
	limit: number;
	onPageChange: (page: number) => void;
	onOpen: (id: string) => void;
	onAddContract: () => void;
	projectId?: string;
	/** True when a filter is narrowing the list, so "empty" means "no match". */
	filtered: boolean;
	onClearProject: () => void;
}) {
	if (loading) return <FinanceLoading />;

	if (!items.length) {
		/*
		 * A project filter that finds nothing is usually not a typo.
		 *
		 * Client agreements are always `flexible` — a project-scoped client
		 * contract requires the Client seat to BE the project owner, which the
		 * consultant who owns the project cannot also be — so they carry no
		 * project_id and a project filter can never match one. Saying "no
		 * contracts match" reads as a broken filter; naming the reason and
		 * offering the way out does not.
		 */
		if (projectId) {
			return (
				<AppEmptyState
					icon={FileSignature}
					title="No agreement is scoped to this project"
					description="Client agreements are held as flexible contracts, which cover the relationship rather than one project — so they never appear under a project filter. Only project-scoped talent agreements do."
					action={
						<button
							type="button"
							onClick={onClearProject}
							className="app-cta inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white"
						>
							Show all agreements
						</button>
					}
				/>
			);
		}
		return (
			<AppEmptyState
				icon={FileSignature}
				title={filtered ? "No contracts match" : "No contracts yet"}
				description={
					filtered
						? "Clear a filter, or create a draft agreement for another project."
						: "Create a draft agreement for a project or a flexible engagement, then complete its terms in the document editor."
				}
				action={
					<button
						type="button"
						onClick={onAddContract}
						className="app-cta inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white"
					>
						<Plus className="h-4 w-4" /> Add contract
					</button>
				}
			/>
		);
	}

	return (
		<div className="space-y-4 pb-8">
			<FinanceSectionHeading
				eyebrow={projectId ? "Project contracts" : "Contract portfolio"}
				title="Agreements"
				description="Every version of every agreement, on both sides of the ledger."
				count={countLabel(total, "contract")}
				actions={
					// One CTA. The project-scoped view used to render "Add contract"
					// and "+ New version" side by side, which read as two ways to do
					// the same thing — and a new version is an amendment, raised from
					// inside the contract, not from a list.
					<button
						type="button"
						onClick={onAddContract}
						className="app-cta inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white"
					>
						<Plus className="h-3.5 w-3.5" /> Add contract
					</button>
				}
			/>
			<AppSurfaceCard className="divide-y divide-border overflow-hidden">
				{items.map((item) => (
					<ContractRow key={item.id} item={item} onOpen={onOpen} />
				))}
			</AppSurfaceCard>
			<FinancePager
				page={page}
				limit={limit}
				total={total}
				onChange={onPageChange}
			/>
		</div>
	);
}

function ContractRow({
	item,
	onOpen,
}: {
	item: FinanceContractSummary;
	onOpen: (id: string) => void;
}) {
	const isTalent = item.relationship_kind === "talent_services";
	const severed = !item.project_id && item.scope_mode === "project_specific";
	const counterparty = isTalent
		? (item.provider_name ?? "Talent not set")
		: (item.client_name ?? "Client not set");
	const title =
		item.project?.title ??
		item.project_title_snapshot ??
		(item.scope_mode === "flexible"
			? "Flexible engagement"
			: "Project removed");

	return (
		<button
			type="button"
			onClick={() => onOpen(item.id)}
			className="group flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-muted/40 md:px-5 md:py-4"
		>
			<span className="flex min-w-0 items-center gap-3">
				<span
					className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isTalent ? "bg-info/10 text-info-foreground" : "bg-primary/10 text-primary"}`}
				>
					{isTalent ? (
						<Handshake className="h-5 w-5" />
					) : (
						<FileSignature className="h-5 w-5" />
					)}
				</span>
				<span className="min-w-0">
					<span className="flex min-w-0 items-center gap-2">
						<span className="truncate font-semibold text-foreground">
							{title}
						</span>
						{severed && (
							<span
								title="The project this contract was scoped to has been deleted. The agreement itself survives."
								className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
							>
								<Unlink className="h-2.5 w-2.5" /> Detached
							</span>
						)}
					</span>
					<span className="mt-1 block truncate text-xs text-muted-foreground">
						{item.contract_number ?? `Version ${item.version}`} ·{" "}
						{isTalent ? "Talent" : "Client"}: {counterparty}
						{item.service_start_date
							? ` · from ${formatFinanceDate(item.service_start_date)}`
							: ""}
					</span>
				</span>
			</span>
			<span className="flex shrink-0 items-center gap-3">
				<ContractValue item={item} />
				<FinanceStatusBadge status={item.status} />
				<ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
			</span>
		</button>
	);
}

/**
 * A contract's headline number, which the list never showed — a portfolio of
 * agreements with no money on it made the reader open each one to compare them.
 */
function ContractValue({ item }: { item: FinanceContractSummary }) {
	const value =
		item.billing_mode === "fixed"
			? { amount: item.fixed_fee, suffix: "" }
			: item.billing_mode === "hourly"
				? { amount: item.client_hourly_rate, suffix: "/hr" }
				: { amount: item.recurring_fee, suffix: "/period" };
	if (value.amount === null || value.amount === undefined) return null;
	return (
		<span className="hidden text-right text-sm font-semibold text-foreground tabular-nums sm:block">
			{formatCurrency(Number(value.amount), item.currency)}
			<span className="font-normal text-muted-foreground">{value.suffix}</span>
		</span>
	);
}
