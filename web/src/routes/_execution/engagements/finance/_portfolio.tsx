import {
	createFileRoute,
	Link,
	Outlet,
	useNavigate,
	useRouterState,
	useSearch,
} from "@tanstack/react-router";
import {
	ArrowLeft,
	BarChart3,
	CircleDollarSign,
	FileSignature,
	ReceiptText,
} from "lucide-react";
import { AppEmptyState } from "@/components/common/AppPrimitives";
import {
	FINANCE_CRUMB_LINK_CLASS,
	FinanceBreadcrumbs,
	FinanceCurrentCrumb,
} from "@/components/finance/portfolio/FinanceBreadcrumbs";
import { FinanceFiltersBar } from "@/components/finance/portfolio/FinanceFiltersBar";
import {
	type FinanceSearchState,
	type FinanceSection,
	financeSectionFromPathname,
} from "@/components/finance/portfolio/financeSearch";
import { useFinanceProjectOptions } from "@/components/finance/portfolio/useFinanceProjectOptions";
import { isActiveConsultant } from "@/lib/auth-utils";
import { useProfile } from "@/stores/authStore";

/**
 * The shared workspace chrome for the three finance sections.
 *
 * Pathless on purpose. The sections need one persistent header, tab bar and
 * filter toolbar across `/engagements/finance`, `/contracts`
 * and `/invoices`, but the contract editor at `/engagements/finance/$contractId`
 * and the invoice builders under `/invoices/new` and `/invoices/$invoiceId/edit`
 * are full-page documents that must NOT inherit a tab bar. A pathless layout
 * wraps exactly the first group while leaving the second as siblings, without
 * adding a segment to any URL.
 *
 * Because it is a layout rather than a component each page renders, switching
 * sections keeps the filter toolbar mounted — the filters are shared state, and
 * remounting them on every tab click would flash the whole bar.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/_portfolio",
)({
	component: FinancePortfolioLayout,
});

const FINANCE_TABS: Array<{
	id: FinanceSection;
	label: string;
	icon: typeof BarChart3;
}> = [
	{ id: "overview", label: "Overview", icon: BarChart3 },
	{ id: "contracts", label: "Contracts", icon: FileSignature },
	{ id: "invoices", label: "Invoices", icon: ReceiptText },
];

function FinancePortfolioLayout() {
	const profile = useProfile();
	const isConsultant = isActiveConsultant(profile);
	const navigate = useNavigate();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const section = financeSectionFromPathname(pathname);
	// The section routes declare different search shapes, so the layout reads
	// them loosely and each route's own validator remains the authority.
	const search = useSearch({ strict: false }) as FinanceSearchState;

	const projectOptionsQuery = useFinanceProjectOptions(search, isConsultant);
	const selectedProject = projectOptionsQuery.data?.projects.find(
		(project) => project.id === search.projectId,
	);

	// Written out per section rather than with a computed `to`, because the
	// router types `to` against the known route paths and a variable would widen
	// it to string.
	const updateSearch = (patch: Partial<FinanceSearchState>) => {
		const next = { ...search, ...patch };
		switch (section) {
			case "contracts":
				void navigate({
					to: "/engagements/finance/contracts",
					search: next,
					replace: true,
				});
				return;
			case "invoices":
				void navigate({
					to: "/engagements/finance/invoices",
					search: next,
					replace: true,
				});
				return;
			default:
				void navigate({
					to: "/engagements/finance",
					search: next,
					replace: true,
				});
		}
	};

	if (profile && !isConsultant) {
		return (
			<div className="mx-auto max-w-4xl px-5 py-10">
				<AppEmptyState
					icon={CircleDollarSign}
					title="Finance is for active consultants"
					description="Once your consultant profile is verified, contracts, client invoices, and portfolio financials will appear here."
				/>
			</div>
		);
	}

	// Section tabs carry the shared filters forward but drop the params that
	// only one section understands, so a contract-status filter cannot ride
	// along into Invoices and sit there unapplied.
	const sharedSearch = {
		q: search.q,
		projectId: search.projectId,
		projectStatus: search.projectStatus,
		currency: search.currency,
		from: search.from,
		to: search.to,
	};

	const currentTab = FINANCE_TABS.find((tab) => tab.id === section);

	return (
		<div className="app-shell-bg min-h-full px-5 py-4 md:px-8 md:py-5">
			<div className="mx-auto w-full max-w-7xl">
				<header>
					<FinanceBreadcrumbs
						items={[
							<Link
								key="engagements"
								to="/engagements"
								className={FINANCE_CRUMB_LINK_CLASS}
							>
								Engagements
							</Link>,
							section === "overview" ? (
								<FinanceCurrentCrumb key="finance">Finance</FinanceCurrentCrumb>
							) : (
								<Link
									key="finance"
									to="/engagements/finance"
									search={sharedSearch}
									className={FINANCE_CRUMB_LINK_CLASS}
								>
									Finance
								</Link>
							),
							...(section === "overview"
								? []
								: [
										<FinanceCurrentCrumb key="section">
											{currentTab?.label ?? "Finance"}
										</FinanceCurrentCrumb>,
									]),
							...(selectedProject
								? [
										<FinanceCurrentCrumb key="project">
											{selectedProject.title}
										</FinanceCurrentCrumb>,
									]
								: []),
						]}
					/>

					<div className="mt-2 flex items-center justify-between gap-4">
						<div className="flex min-w-0 items-center gap-2.5">
							<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/10 text-foreground">
								<CircleDollarSign className="h-4 w-4" />
							</span>
							<div className="min-w-0 leading-tight">
								<h1 className="text-sm font-semibold text-foreground">
									Finance
								</h1>
								<p className="truncate text-[11px] text-muted-foreground">
									Contracts, invoices, revenue, and delivery costs across your
									projects
								</p>
							</div>
						</div>
						<span className="hidden shrink-0 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground sm:inline-flex">
							{projectOptionsQuery.isPending
								? "Loading projects…"
								: `${projectOptionsQuery.data?.projects.length ?? 0} projects`}
						</span>
					</div>

					<div className="mt-3 border-b border-border">
						<nav
							aria-label="Finance sections"
							className="-mb-px flex min-w-max gap-6 overflow-x-auto"
						>
							{FINANCE_TABS.map((tab) => {
								const Icon = tab.icon;
								const active = tab.id === section;
								const className = `inline-flex h-10 items-center gap-2 border-b-2 px-1 text-xs font-semibold transition-colors ${
									active
										? "border-primary text-primary"
										: "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
								}`;
								const label = (
									<>
										<Icon className="h-4 w-4" />
										{tab.label}
									</>
								);
								const linkProps = {
									className,
									"aria-current": active ? ("page" as const) : undefined,
									search: sharedSearch,
								};
								return tab.id === "overview" ? (
									<Link key={tab.id} to="/engagements/finance" {...linkProps}>
										{label}
									</Link>
								) : tab.id === "contracts" ? (
									<Link
										key={tab.id}
										to="/engagements/finance/contracts"
										{...linkProps}
									>
										{label}
									</Link>
								) : (
									<Link
										key={tab.id}
										to="/engagements/finance/invoices"
										{...linkProps}
									>
										{label}
									</Link>
								);
							})}
						</nav>
					</div>
				</header>

				<FinanceFiltersBar
					search={search}
					section={section}
					projects={projectOptionsQuery.data?.projects ?? []}
					onChange={updateSearch}
				/>

				{search.projectId && (
					<div className="mb-1 flex min-w-0 items-center gap-2 text-sm">
						<button
							type="button"
							onClick={() =>
								updateSearch({ projectId: undefined, step: undefined })
							}
							className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-primary hover:underline"
						>
							<ArrowLeft className="h-4 w-4" /> All projects
						</button>
						<span className="text-border">/</span>
						<span className="truncate font-medium text-foreground">
							{selectedProject?.title ?? "Selected project"}
						</span>
					</div>
				)}

				<Outlet />
			</div>
		</div>
	);
}
