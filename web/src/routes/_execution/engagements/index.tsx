import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
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
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
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
import { useAuthStore, useProfile } from "@/stores/authStore";

/**
 * Engagements the signed-in user is a party to.
 *
 * Canonical home of this page. It lived at `/marketplace/finance/engagements`
 * behind the finance area's consultant wall, which was wrong for two of the
 * three seats: `GET /api/engagements` scopes by party membership on purpose —
 * a Client or Talent can read their own agreements — but the only UI that
 * called it refused to render for them. Nothing about the page is
 * consultant-specific, so, like `/invites`, the only guard is authentication.
 *
 * The old finance URL is gone rather than redirected: it shipped days earlier,
 * consultant-only, and nothing durable (notification rows, emails, triggers)
 * ever carried the path — the one situation where the "old URLs live forever"
 * rule has nothing to protect.
 *
 * Layout: a page title, a left rail of views, and the list — the rail is
 * navigation between slices of one collection, not a sitemap, which is why it
 * lives on the page rather than in an app sidebar.
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
	/** The viewer's seat, not the engagement kind — see SIDE_VIEWS. */
	side?: EngagementPosition;
	status?: EngagementStatus;
	projectId?: string;
};

/**
 * Sliced by the viewer's own seat rather than by `kind`: a `client_services`
 * engagement means "you were hired" to its consultant and "you hired" to its
 * client, so kind-based labels would lie to one of them. The API filters by
 * kind only, so this slice is applied client-side.
 */
const SIDE_VIEWS: {
	side: EngagementPosition | undefined;
	label: string;
	icon: LucideIcon;
}[] = [
	{ side: undefined, label: "All engagements", icon: Handshake },
	{ side: "hirer", label: "People you hired", icon: UserRound },
	{ side: "provider", label: "You were hired", icon: BriefcaseBusiness },
];

const STATUS_VIEWS: { status: EngagementStatus | undefined; label: string }[] =
	[
		{ status: undefined, label: "Any status" },
		{ status: "active", label: "Active" },
		{ status: "ended", label: "Ended" },
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
	beforeLoad: () => {
		if (!useAuthStore.getState().isAuthenticated) {
			throw redirect({
				to: "/auth/login",
				search: { redirect: "/engagements" },
			});
		}
	},
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

	const currentView =
		SIDE_VIEWS.find((view) => view.side === search.side) ?? SIDE_VIEWS[0];
	const items = (engagementsQuery.data ?? []).filter(
		(engagement) => !search.side || engagement.viewer_position === search.side,
	);

	return (
		<ProtectedRoute loadingFallback={null}>
			<div className="app-shell-bg min-h-screen bg-background px-5 pb-10 pt-app-header text-foreground md:px-8">
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

					<div className="mt-6 flex flex-col gap-8 md:flex-row md:gap-12">
						<aside className="w-full shrink-0 md:w-56">
							<p className="mb-2 text-sm text-muted-foreground">
								Based on your role
							</p>
							<nav className="flex flex-row flex-wrap gap-1 md:flex-col">
								{SIDE_VIEWS.map((view) => {
									const active = view.side === search.side;
									const Icon = view.icon;
									return (
										<button
											key={view.label}
											type="button"
											onClick={() => setSearch({ side: view.side })}
											aria-current={active ? "true" : undefined}
											className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
												active
													? "bg-muted font-semibold text-foreground"
													: "text-foreground hover:bg-muted/60"
											}`}
										>
											<Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
											{view.label}
										</button>
									);
								})}
							</nav>

							<p className="mb-2 mt-7 text-sm text-muted-foreground">Status</p>
							<nav className="flex flex-row flex-wrap gap-1 md:flex-col">
								{STATUS_VIEWS.map((view) => {
									const active = view.status === search.status;
									return (
										<button
											key={view.label}
											type="button"
											onClick={() => setSearch({ status: view.status })}
											aria-current={active ? "true" : undefined}
											className={`rounded-lg px-3 py-2 text-left text-sm transition-colors ${
												active
													? "bg-muted font-semibold text-foreground"
													: "text-foreground hover:bg-muted/60"
											}`}
										>
											{view.label}
										</button>
									);
								})}
							</nav>

							<p className="mt-7 hidden text-sm leading-6 text-muted-foreground md:block">
								An engagement opens when both parties sign a contract, and
								records who hired whom and on what terms.
							</p>
						</aside>

						<main className="min-w-0 flex-1">
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

							<h2 className="text-base font-semibold text-foreground">
								{currentView.label}
							</h2>
							<p className="mb-5 mt-1 text-sm text-muted-foreground">
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
						</main>
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
		</ProtectedRoute>
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
