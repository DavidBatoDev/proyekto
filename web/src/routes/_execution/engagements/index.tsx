import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	BriefcaseBusiness,
	ChevronRight,
	FileSignature,
	Handshake,
	type LucideIcon,
	Plus,
	UserRound,
} from "lucide-react";
import { useState } from "react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import { AppTabs } from "@/components/common/AppTabs";
import { Dropdown, type DropdownOption } from "@/components/common/Dropdown";
import { EngagementPortfolio } from "@/components/engagements/EngagementPortfolio";
import { CreateContractDialog } from "@/components/finance/portfolio/CreateContractDialog";
import {
	countLabel,
	FinanceStatusBadge,
} from "@/components/finance/portfolio/FinancePrimitives";
import { useFinanceProjectOptions } from "@/components/finance/portfolio/useFinanceProjectOptions";
import { useToast } from "@/hooks/useToast";
import { isActiveConsultant } from "@/lib/auth-utils";
import {
	type ContractRelationshipKind,
	type ContractScopeMode,
	contractService,
} from "@/services/contract.service";
import type {
	EngagementPosition,
	EngagementStatus,
} from "@/services/engagement.service";
import { engagementService } from "@/services/engagement.service";
import {
	type FinanceContractSummary,
	financeService,
} from "@/services/finance.service";
import { useProfile } from "@/stores/authStore";

/**
 * Engagements the signed-in user is a party to.
 *
 * Canonical home of this page. It lived at `/marketplace/finance/engagements`
 * behind the finance area's consultant wall, which was wrong for two of the
 * three seats: `GET /api/engagements` scopes by party membership on purpose —
 * a Client or Talent can read their own agreements — but the only UI that
 * called it refused to render for them. Nothing about the page is
 * consultant-specific, so, like `/invites`, the only guard is authentication —
 * applied once by the `/engagements` layout, which also supplies this page's
 * shell chrome, so the body below renders bare.
 *
 * The old finance URL is gone rather than redirected: it shipped days earlier,
 * consultant-only, and nothing durable (notification rows, emails, triggers)
 * ever carried the path — the one situation where the "old URLs live forever"
 * rule has nothing to protect.
 *
 * Layout: a page title, a left rail of views, and the list. The rail stays on
 * the page even though the shell now supplies a sidebar beside it — it filters
 * one collection rather than naming destinations, and folding those slices
 * into the sidebar would mix filters into a sitemap.
 *
 * Contract operations live here too, because a contract is how an engagement
 * comes to exist: a verified consultant can draft one from the header button,
 * and drafts and sent contracts appear as an "In signing" pipeline above the
 * engagement list — each row is an engagement that has not opened yet. Both
 * are consultant-only, matching the locked rule that only a verified
 * consultant authors contracts; other seats sign through the links they are
 * sent, so they see their agreements arrive directly as engagements.
 */

const SIDES = ["hirer", "provider"] as const;
const STATUSES = ["active", "ended", "cancelled"] as const;

type EngagementsSearch = {
	/** The viewer's seat, not the engagement kind — see SIDE_TABS. */
	side?: EngagementPosition;
	status?: EngagementStatus;
	projectId?: string;
};

/**
 * The tabs across the list.
 *
 * Sliced by the viewer's own seat rather than by `kind`: a `client_services`
 * engagement means "you were hired" to its consultant and "you hired" to its
 * client, so kind-based labels would lie to one of them. The API filters by
 * kind only, so this slice is applied client-side.
 *
 * `all` is the key for "no seat filter" because a tab strip needs a value for
 * every tab; it maps back to `side: undefined` in the URL.
 */
const SIDE_TABS: {
	key: string;
	side?: EngagementPosition;
	label: string;
	icon: LucideIcon;
}[] = [
	{ key: "all", side: undefined, label: "All engagements", icon: Handshake },
	{ key: "hirer", side: "hirer", label: "People you hired", icon: UserRound },
	{
		key: "provider",
		side: "provider",
		label: "You were hired",
		icon: BriefcaseBusiness,
	},
];

/** Status narrows whichever tab is open, so it is a filter rather than a tab. */
const STATUS_OPTIONS: DropdownOption[] = [
	{ value: "", label: "Any status" },
	{ value: "active", label: "Active" },
	{ value: "ended", label: "Ended" },
];

export const Route = createFileRoute("/_execution/engagements/")({
	validateSearch: (search: Record<string, unknown>): EngagementsSearch => ({
		side: SIDES.includes(search.side as EngagementPosition)
			? (search.side as EngagementPosition)
			: undefined,
		status: STATUSES.includes(search.status as EngagementStatus)
			? (search.status as EngagementStatus)
			: undefined,
		projectId:
			typeof search.projectId === "string" && search.projectId
				? search.projectId
				: undefined,
	}),
	component: EngagementsPage,
});

function EngagementsPage() {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const qc = useQueryClient();
	const toast = useToast();
	const profile = useProfile();
	const isConsultant = isActiveConsultant(profile);
	const [createContractOpen, setCreateContractOpen] = useState(false);

	const engagementsQuery = useQuery({
		queryKey: ["engagements", search.status, search.projectId],
		queryFn: () =>
			engagementService.list({
				status: search.status,
				project_id: search.projectId,
			}),
	});

	// The pre-signing pipeline. `/api/finance/contracts` is consultant-gated on
	// the server, so the query must not fire for other seats.
	const contractsQuery = useQuery({
		queryKey: ["engagements", "contract-pipeline"],
		queryFn: () => financeService.contracts({ page: 1, limit: 50 }),
		enabled: isConsultant,
	});
	const pipeline = (contractsQuery.data?.items ?? []).filter(
		(contract) => contract.status === "draft" || contract.status === "sent",
	);

	const projectOptionsQuery = useFinanceProjectOptions({}, isConsultant);

	const openContract = (contractId: string) =>
		void navigate({
			to: "/engagements/finance/$contractId",
			params: { contractId },
			search: { section: undefined },
		});

	const createContractMutation = useMutation({
		mutationFn: (input: {
			project_id?: string | null;
			relationship_kind: ContractRelationshipKind;
			scope_mode: ContractScopeMode;
			counterparty_user_id?: string;
		}) => contractService.create(input),
		onSuccess: (created) => {
			setCreateContractOpen(false);
			void qc.invalidateQueries({
				queryKey: ["engagements", "contract-pipeline"],
			});
			void qc.invalidateQueries({ queryKey: ["finance", "contracts"] });
			toast.success("Draft contract created");
			void navigate({
				to: "/engagements/finance/$contractId",
				params: { contractId: created.id },
				search: { section: "parties" },
			});
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const setSearch = (patch: Partial<EngagementsSearch>) =>
		void navigate({
			to: "/engagements",
			search: { ...search, ...patch },
			replace: true,
		});

	const currentTab =
		SIDE_TABS.find((tab) => tab.side === search.side) ?? SIDE_TABS[0];
	const items = (engagementsQuery.data ?? []).filter(
		(engagement) => !search.side || engagement.viewer_position === search.side,
	);

	return (
		<>
			<div className="min-h-full px-5 pb-10 md:px-8">
				<div className="mx-auto w-full max-w-7xl pt-6 md:pt-8">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<h1 className="text-2xl font-bold tracking-tight text-foreground">
							Engagements
						</h1>
						{isConsultant && (
							<button
								type="button"
								onClick={() => setCreateContractOpen(true)}
								className="app-cta inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white"
							>
								<Plus className="h-4 w-4" /> New contract
							</button>
						)}
					</div>

					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						An engagement opens when both parties sign a contract, and records
						who hired whom and on what terms.
					</p>

					{/*
					 * The rule belongs to this row rather than to AppTabs, so it runs
					 * past the tabs and under the status filter as one line; the tab
					 * strip's own border is dropped so the active tab's rule lands on
					 * that line instead of a second one above it.
					 */}
					<div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-b border-border">
						<AppTabs
							variant="underline"
							size="sm"
							className="border-b-0"
							items={SIDE_TABS.map((tab) => ({
								key: tab.key,
								label: (
									<>
										<tab.icon className="h-4 w-4" />
										{tab.label}
									</>
								),
							}))}
							active={currentTab.key}
							linkFor={(key) => ({
								to: "/engagements",
								search: {
									...search,
									side: SIDE_TABS.find((tab) => tab.key === key)?.side,
								},
							})}
						/>
						<Dropdown
							value={search.status ?? ""}
							onChange={(value) =>
								setSearch({
									status: (value || undefined) as EngagementStatus | undefined,
								})
							}
							options={STATUS_OPTIONS}
							ariaLabel="Filter engagements by status"
							className="mb-2 w-40"
						/>
					</div>

					<div className="mt-6">
						{pipeline.length > 0 && (
							<section className="mb-8">
								<h2 className="text-base font-semibold text-foreground">
									In signing
								</h2>
								<p className="mb-4 mt-1 text-sm text-muted-foreground">
									{countLabel(pipeline.length, "contract")} not yet signed by
									both parties — each becomes an engagement once it is.
								</p>
								<AppSurfaceCard className="divide-y divide-border overflow-hidden">
									{pipeline.map((contract) => (
										<PipelineRow
											key={contract.id}
											contract={contract}
											onOpen={openContract}
										/>
									))}
								</AppSurfaceCard>
							</section>
						)}

						<p className="mb-5 text-sm text-muted-foreground">
							{engagementsQuery.isPending
								? "Loading…"
								: countLabel(items.length, "engagement")}
						</p>

						<EngagementPortfolio
							loading={engagementsQuery.isPending}
							error={engagementsQuery.error as Error | null}
							items={items}
							filtered={Boolean(search.projectId)}
							onClearProject={() => setSearch({ projectId: undefined })}
							onOpen={(engagementId) =>
								void navigate({
									to: "/engagements/$engagementId",
									params: { engagementId },
								})
							}
						/>
					</div>
				</div>
			</div>

			<CreateContractDialog
				open={createContractOpen}
				projects={projectOptionsQuery.data?.projects ?? []}
				loading={projectOptionsQuery.isPending}
				creating={createContractMutation.isPending}
				onClose={() => setCreateContractOpen(false)}
				onCreate={(input) => createContractMutation.mutate(input)}
			/>
		</>
	);
}

/**
 * A contract that has not been signed by both parties yet, shaped like the
 * engagement rows below it so the pipeline reads as "these are next".
 */
function PipelineRow({
	contract,
	onOpen,
}: {
	contract: FinanceContractSummary;
	onOpen: (contractId: string) => void;
}) {
	const counterparty =
		contract.relationship_kind === "client_services"
			? contract.client_name
			: contract.provider_name;
	return (
		<button
			type="button"
			onClick={() => onOpen(contract.id)}
			className="group flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-muted/40 md:px-5 md:py-4"
		>
			<span className="flex min-w-0 items-center gap-3">
				<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning-foreground">
					<FileSignature className="h-5 w-5" />
				</span>
				<span className="min-w-0">
					<span className="block truncate font-semibold text-foreground">
						{counterparty
							? `Contract with ${counterparty}`
							: "Contract — counterparty not named yet"}
					</span>
					<span className="mt-1 block truncate text-xs text-muted-foreground">
						{contract.relationship_kind === "client_services"
							? "Client engagement"
							: "Talent engagement"}{" "}
						· {contract.project_title_snapshot ?? "Flexible scope"}
					</span>
				</span>
			</span>
			<span className="flex shrink-0 items-center gap-3">
				<FinanceStatusBadge status={contract.status} />
				<ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
			</span>
		</button>
	);
}
