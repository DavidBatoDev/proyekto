import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ChevronRight,
	FileSignature,
	FileText,
	FolderKanban,
	Handshake,
	type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { isActiveConsultant } from "@/lib/auth-utils";
import { describeDuration } from "@/lib/durations";
import { engagementService } from "@/services/engagement.service";
import { financeService } from "@/services/finance.service";
import {
	type PostingListEntry,
	postingsService,
} from "@/services/postings.service";
import {
	type ProjectRoadmapSummary,
	projectService,
} from "@/services/project.service";
import { useProfile, useUser } from "@/stores/authStore";
import { EmptyWorkspaceArt } from "./CapabilityIcons";

type TabKey = "projects" | "briefs" | "engagements" | "contracts";

interface TabDefinition {
	key: TabKey;
	label: string;
	icon: LucideIcon;
	/** Only offered to a verified consultant. */
	consultantOnly?: boolean;
}

const TABS: TabDefinition[] = [
	{ key: "projects", label: "Your projects", icon: FolderKanban },
	{ key: "briefs", label: "Latest Brief", icon: FileText },
	{ key: "engagements", label: "Your engagements", icon: Handshake },
	{
		key: "contracts",
		label: "Your contracts",
		icon: FileSignature,
		consultantOnly: true,
	},
];

const CTA_CLASS =
	"inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90";

/**
 * The signed-in continuation panel: a rail of what you already have here, and
 * a panel showing the most recent few of it.
 *
 * Every tab is backed by data that exists — projects, engagements, contracts.
 * The reference design also offers "recently viewed" and "saved" lists; neither
 * has any storage behind it in this product, and a tab that silently never
 * fills is worse than one that is absent, so they wait until something records
 * them.
 *
 * Renders nothing for anonymous visitors. There is no "where you left off" for
 * someone without an account, and an empty scaffold above the storefront is
 * just noise.
 */
export function PickUpWhereYouLeftOff() {
	const user = useUser();
	const profile = useProfile();
	const consultant = isActiveConsultant(profile);
	const visibleTabs = TABS.filter((tab) => !tab.consultantOnly || consultant);
	const [active, setActive] = useState<TabKey>("projects");

	// Each query is gated on its own tab so opening the page fetches one list,
	// not three.
	const projectsQuery = useQuery({
		queryKey: ["marketplace-home", "projects"],
		queryFn: () => projectService.listDashboardProjects(),
		enabled: !!user && active === "projects",
	});
	// `["postings", "mine"]` is the shared key for this list wherever it is
	// read, so a second surface would hit the cache rather than refetch.
	const briefsQuery = useQuery({
		queryKey: ["postings", "mine"] as const,
		queryFn: () => postingsService.listMine(),
		staleTime: 30 * 1000,
		enabled: !!user && active === "briefs",
	});
	const engagementsQuery = useQuery({
		queryKey: ["marketplace-home", "engagements"],
		queryFn: () => engagementService.list(),
		enabled: !!user && active === "engagements",
	});
	const contractsQuery = useQuery({
		queryKey: ["marketplace-home", "contracts"],
		queryFn: () => financeService.contracts({}),
		enabled: !!user && consultant && active === "contracts",
	});

	if (!user) return null;

	const isPending =
		(active === "projects" && projectsQuery.isPending) ||
		(active === "briefs" && briefsQuery.isPending) ||
		(active === "engagements" && engagementsQuery.isPending) ||
		(active === "contracts" && contractsQuery.isPending);

	return (
		<section className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
			<div className="flex items-baseline justify-between gap-4">
				<h2 className="text-[17px] font-semibold text-foreground">
					Pick up where you left off
				</h2>
				<SeeAllLink active={active} consultant={consultant} />
			</div>

			<div className="mt-4 grid gap-4 lg:grid-cols-[220px_1fr]">
				<nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
					{visibleTabs.map((tab) => {
						const Icon = tab.icon;
						const selected = tab.key === active;
						return (
							<button
								key={tab.key}
								type="button"
								onClick={() => setActive(tab.key)}
								aria-current={selected ? "true" : undefined}
								className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3.5 py-3 text-left text-[15px] transition-colors ${
									selected
										? "bg-muted font-semibold text-foreground"
										: "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
								}`}
							>
								<Icon className="h-[18px] w-[18px] shrink-0" />
								<span className="whitespace-nowrap">{tab.label}</span>
							</button>
						);
					})}
				</nav>

				{/* Fixed, not min: the panel is exactly three rows tall, so the page
				    does not jolt as you move between a full tab and an empty one.
				    Three, not four — a two-line row is 66px, and four of them plus the
				    padding come to 306px, which would have to either clip or make the
				    box taller than any tab needs. "See all" is where the rest lives.
				    overflow-hidden is the guard if a row ever grows past its line. */}
				<div className="h-[244px] overflow-hidden rounded-xl border border-border bg-card p-5">
					{isPending ? (
						<div className="space-y-2.5">
							{Array.from({ length: 3 }, (_, index) => (
								<div
									key={`row-skeleton-${index}`}
									className="h-12 animate-pulse rounded-lg bg-muted"
								/>
							))}
						</div>
					) : active === "projects" ? (
						<ProjectRows projects={projectsQuery.data ?? []} />
					) : active === "briefs" ? (
						<BriefRows briefs={briefsQuery.data ?? []} />
					) : active === "engagements" ? (
						<EngagementRows engagements={engagementsQuery.data ?? []} />
					) : (
						<ContractRows contracts={contractsQuery.data?.items ?? []} />
					)}
				</div>
			</div>
		</section>
	);
}

/**
 * The way out of the panel and into the full surface behind the active tab.
 *
 * Only the two finance-backed tabs have a "rest of it" to point at, and finance
 * is consultant-gated, so an unverified user is offered nothing rather than a
 * link that would bounce them off an empty state. Projects lead back to the
 * workspace, which is execution's surface, not the marketplace's.
 */
function SeeAllLink({
	active,
	consultant,
}: {
	active: TabKey;
	consultant: boolean;
}) {
	const className = "text-[13px] font-medium text-primary hover:underline";
	if (active === "projects") {
		return (
			<Link to="/dashboard" className={className}>
				See all
			</Link>
		);
	}
	if (active === "briefs") {
		// The board at /marketplace/briefs is the CONSULTANT's view of other
		// people's briefs, so it is not "all of yours". The dashboard is.
		return (
			<Link to="/dashboard" className={className}>
				See all
			</Link>
		);
	}
	if (active === "engagements") {
		return (
			<Link to="/engagements" className={className}>
				See all
			</Link>
		);
	}
	if (!consultant) return null;
	return (
		<Link to="/marketplace/finance/contracts" className={className}>
			See all in Finance
		</Link>
	);
}

function EmptyPanel({
	title,
	body,
	cta,
}: {
	title: string;
	body: string;
	cta: ReactNode;
}) {
	return (
		<div className="flex h-full flex-col items-start justify-center gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div className="max-w-md">
				<h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
				<p className="mt-1 text-[13px] text-muted-foreground">{body}</p>
				<div className="mt-4">{cta}</div>
			</div>
			<EmptyWorkspaceArt className="hidden h-24 w-24 shrink-0 sm:block" />
		</div>
	);
}

/**
 * One row, shared by all four tabs so they stay one list rather than four
 * lookalikes: a tinted glyph tile, the name, a quiet meta line, and the state
 * as a pill on the right.
 *
 * The state used to sit inside `subtitle`, which meant "Draft" and "6+ months"
 * were the same weight and the same colour — the one word that says what you
 * can DO with the row was buried in the one line nobody reads. Pulling it out
 * is the whole point of the pill.
 */
function RowShell({
	children,
	icon: Icon,
	title,
	subtitle,
	pill,
	pillTone = "muted",
}: {
	children: (content: ReactNode) => ReactNode;
	icon: LucideIcon;
	title: string;
	/** Optional: rows with nothing quiet to add simply do not have one. */
	subtitle?: string;
	pill?: string;
	pillTone?: "primary" | "muted";
}) {
	return children(
		<>
			<span className="flex min-w-0 items-center gap-3">
				<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<Icon className="h-4 w-4" />
				</span>
				<span className="min-w-0">
					<span className="block truncate text-[14px] font-medium text-foreground">
						{title}
					</span>
					{subtitle ? (
						<span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
							{subtitle}
						</span>
					) : null}
				</span>
			</span>
			<span className="flex shrink-0 items-center gap-2.5">
				{pill ? (
					<span
						className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${
							pillTone === "primary"
								? "bg-primary/10 text-primary"
								: "bg-muted text-muted-foreground"
						}`}
					>
						{pill}
					</span>
				) : null}
				<ChevronRight className="h-4 w-4 text-muted-foreground" />
			</span>
		</>,
	);
}

const ROW_CLASS =
	"flex items-center justify-between gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-muted/60";
/** Hairlines between rows, never above the first or below the last. */
const LIST_CLASS = "-mx-3 divide-y divide-border/60";

/**
 * The row's second line: which roadmap the project has, and how big it is.
 *
 * The same three facts the dashboard card carries, folded onto one line —
 * name, then scale, then how much of it is done. A project with no roadmap
 * says so rather than showing a blank line, because "no roadmap yet" is the
 * most actionable thing that row can tell you.
 */
function describeRoadmap(summary: ProjectRoadmapSummary | null | undefined) {
	if (!summary) return "No roadmap yet";
	const parts = [
		summary.name,
		`${summary.epic_count} ${summary.epic_count === 1 ? "epic" : "epics"}`,
		`${summary.feature_count} ${summary.feature_count === 1 ? "feature" : "features"}`,
	];
	if (summary.task_count > 0) {
		parts.push(`${summary.done_task_count}/${summary.task_count} tasks done`);
	}
	return parts.join(" · ");
}

function ProjectRows({
	projects,
}: {
	projects: Array<{
		id: string;
		title: string;
		status: string;
		roadmap_summary?: ProjectRoadmapSummary | null;
	}>;
}) {
	if (projects.length === 0) {
		return (
			<EmptyPanel
				title="Start your first project"
				body="Describe what you need and a vetted consultant will scope it — roadmap, deliverables and terms before any work begins."
				cta={
					<Link
						to="/brief/new"
						search={{ need: undefined }}
						className={CTA_CLASS}
					>
						Post a brief
					</Link>
				}
			/>
		);
	}
	return (
		<div className={LIST_CLASS}>
			{projects.slice(0, 3).map((project) => (
				<RowShell
					key={project.id}
					icon={FolderKanban}
					title={project.title}
					subtitle={describeRoadmap(project.roadmap_summary)}
					pill={project.status}
					pillTone={project.status === "active" ? "primary" : "muted"}
				>
					{(content) => (
						<Link
							to="/project/$projectId/overview"
							params={{ projectId: project.id }}
							className={ROW_CLASS}
						>
							{content}
						</Link>
					)}
				</RowShell>
			))}
		</div>
	);
}

/**
 * The author's own briefs, in every state.
 *
 * A draft is reachable only by its URL, so without this there is no way back
 * into one. Drafts open in the editor; anything else opens as it reads, which
 * is where the author reviews who has responded.
 */
function BriefRows({ briefs }: { briefs: PostingListEntry[] }) {
	if (briefs.length === 0) {
		return (
			<EmptyPanel
				title="No briefs yet"
				body="Describe what you need and vetted consultants come to you with scope and pricing."
				cta={
					<Link
						to="/brief/new"
						search={{ need: undefined }}
						className={CTA_CLASS}
					>
						Post a brief
					</Link>
				}
			/>
		);
	}
	return (
		<div className={LIST_CLASS}>
			{briefs.slice(0, 3).map((brief) => {
				// The state is the pill now, so the meta line carries only the two
				// facts a reader scans for: how long, and who has responded.
				const meta = [
					describeDuration(brief.duration, brief.duration_custom),
					brief.status === "published"
						? `${brief.proposal_count} ${brief.proposal_count === 1 ? "proposal" : "proposals"}`
						: null,
				].filter(Boolean);
				return (
					<RowShell
						key={brief.id}
						icon={FileText}
						title={brief.title}
						subtitle={meta.join(" · ")}
						pill={
							brief.status === "published"
								? "Live"
								: brief.status === "closed"
									? "Closed"
									: "Draft"
						}
						pillTone={brief.status === "published" ? "primary" : "muted"}
					>
						{(content) => (
							<Link
								to={
									brief.status === "draft"
										? "/brief/$briefId/edit"
										: "/brief/$briefId"
								}
								params={{ briefId: brief.id }}
								className={`${ROW_CLASS} ${brief.status === "closed" ? "opacity-60" : ""}`}
							>
								{content}
							</Link>
						)}
					</RowShell>
				);
			})}
		</div>
	);
}

function EngagementRows({
	engagements,
}: {
	engagements: Array<{
		id: string;
		kind: string;
		status: string;
		viewer_position: string;
		counterparty: { display_name_snapshot: string | null } | null;
	}>;
}) {
	if (engagements.length === 0) {
		return (
			<EmptyPanel
				title="No engagements yet"
				body="An engagement is created when both sides finish signing a contract. It records who hired whom, on which projects, and at which rates."
				cta={
					<Link to="/marketplace/consultant/browse" className={CTA_CLASS}>
						Browse consultants
					</Link>
				}
			/>
		);
	}
	return (
		<div className={LIST_CLASS}>
			{engagements.slice(0, 3).map((engagement) => {
				const other =
					engagement.counterparty?.display_name_snapshot ?? "Counterparty";
				const kind =
					engagement.kind === "client_services" ? "Client" : "Talent";
				return (
					<RowShell
						key={engagement.id}
						icon={Handshake}
						title={
							engagement.viewer_position === "hirer"
								? `You hired ${other}`
								: `${other} hired you`
						}
						subtitle={`${kind} engagement`}
						pill={engagement.status}
						pillTone={engagement.status === "active" ? "primary" : "muted"}
					>
						{(content) => (
							<Link to="/engagements" className={ROW_CLASS}>
								{content}
							</Link>
						)}
					</RowShell>
				);
			})}
		</div>
	);
}

function ContractRows({
	contracts,
}: {
	contracts: Array<{
		id: string;
		status: string;
		project_title_snapshot: string | null;
		contract_number: string | null;
		version: number;
	}>;
}) {
	if (contracts.length === 0) {
		return (
			<EmptyPanel
				title="No contracts yet"
				body="Draft an agreement for a project, set its terms, and send it for signature. Signing it is what activates the engagement."
				cta={
					<Link to="/marketplace/finance/contracts" className={CTA_CLASS}>
						Go to contracts
					</Link>
				}
			/>
		);
	}
	return (
		<div className={LIST_CLASS}>
			{contracts.slice(0, 3).map((contract) => (
				<RowShell
					key={contract.id}
					icon={FileSignature}
					title={contract.project_title_snapshot ?? "Untitled project"}
					subtitle={contract.contract_number ?? `Version ${contract.version}`}
					pill={contract.status}
					pillTone={contract.status === "active" ? "primary" : "muted"}
				>
					{(content) => (
						<Link
							to="/marketplace/finance/$contractId"
							params={{ contractId: contract.id }}
							search={{ section: undefined }}
							className={ROW_CLASS}
						>
							{content}
						</Link>
					)}
				</RowShell>
			))}
		</div>
	);
}
