import { ChevronRight, FileSignature, Plus } from "lucide-react";
import {
	AppEmptyState,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import type { FinanceContractSummary } from "@/services/finance.service";
import {
	FinanceLoading,
	FinanceSectionHeading,
	FinanceStatusBadge,
} from "./FinancePrimitives";

export function ContractPortfolio({
	loading,
	items,
	onOpen,
	onAddContract,
	projectId,
	onCreate,
	creating = false,
}: {
	loading: boolean;
	items: FinanceContractSummary[];
	onOpen: (id: string) => void;
	onAddContract: () => void;
	projectId?: string;
	onCreate?: () => void;
	creating?: boolean;
}) {
	if (loading) return <FinanceLoading />;
	if (!items.length) {
		if (!projectId || !onCreate) {
			return (
				<AppEmptyState
					icon={FileSignature}
					title="No contracts yet"
					description="Create a draft agreement for any project, then complete its terms in the document editor."
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
			<AppEmptyState
				icon={FileSignature}
				title="No contract for this project"
				description="Create a draft agreement, then complete its terms in the document editor."
				action={
					<button
						type="button"
						onClick={onCreate}
						disabled={creating}
						className="app-cta rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
					>
						{creating ? "Creating…" : "Create draft contract"}
					</button>
				}
			/>
		);
	}
	return (
		<div className="space-y-5 pb-8">
			<div className="flex items-end justify-between gap-4">
				<FinanceSectionHeading
					eyebrow={projectId ? "Project contracts" : "Contract portfolio"}
					title="Client agreements"
					description="Review every agreement version and open it in the document editor."
					count={`${items.length} ${items.length === 1 ? "contract" : "contracts"}`}
				/>
				<button
					type="button"
					onClick={onAddContract}
					className="app-cta mb-1 ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white"
				>
					<Plus className="h-3.5 w-3.5" /> Add contract
				</button>
				{projectId && onCreate && (
					<button
						type="button"
						onClick={onCreate}
						disabled={creating}
						className="app-cta mb-1 shrink-0 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
					>
						{creating ? "Creating…" : "+ New version"}
					</button>
				)}
			</div>
			<AppSurfaceCard className="divide-y divide-border overflow-hidden">
				{items.map((item) => (
					<button
						type="button"
						key={item.id}
						onClick={() => onOpen(item.id)}
						className="group flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-muted/40 md:px-5 md:py-4"
					>
						<span className="flex min-w-0 items-center gap-3">
							<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
								<FileSignature className="h-5 w-5" />
							</span>
							<span className="min-w-0">
								<span className="block truncate font-semibold text-foreground">
									{item.project?.title ??
										item.project_title_snapshot ??
										(item.scope_mode === "flexible"
											? "Flexible engagement"
											: "Project removed")}
								</span>
								<span className="mt-1 block truncate text-xs text-muted-foreground">
									{item.contract_number ?? `Version ${item.version}`} ·{" "}
									{item.relationship_kind === "talent_services"
										? (item.provider_name ?? "Talent not set")
										: (item.client_name ?? "Client not set")}
								</span>
							</span>
						</span>
						<span className="flex shrink-0 items-center gap-3">
							<FinanceStatusBadge status={item.status} />
							<ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
						</span>
					</button>
				))}
			</AppSurfaceCard>
		</div>
	);
}
