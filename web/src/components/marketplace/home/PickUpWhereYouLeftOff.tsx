import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ChevronRight,
	FileSignature,
	FolderKanban,
	Handshake,
	type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { isActiveConsultant } from "@/lib/auth-utils";
import { engagementService } from "@/services/engagement.service";
import { financeService } from "@/services/finance.service";
import { projectService } from "@/services/project.service";
import { useProfile, useUser } from "@/stores/authStore";
import { EmptyWorkspaceArt } from "./CapabilityIcons";

type TabKey = "projects" | "engagements" | "contracts";

interface TabDefinition {
	key: TabKey;
	label: string;
	icon: LucideIcon;
	/** Only offered to a verified consultant. */
	consultantOnly?: boolean;
}

const TABS: TabDefinition[] = [
	{ key: "projects", label: "Your projects", icon: FolderKanban },
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
		(active === "engagements" && engagementsQuery.isPending) ||
		(active === "contracts" && contractsQuery.isPending);

	return (
		<section className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
			<h2 className="text-[17px] font-semibold text-foreground">
				Pick up where you left off
			</h2>

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
								className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] transition-colors ${
									selected
										? "bg-muted font-semibold text-foreground"
										: "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
								}`}
							>
								<Icon className="h-4 w-4 shrink-0" />
								<span className="whitespace-nowrap">{tab.label}</span>
							</button>
						);
					})}
				</nav>

				<div className="min-h-[228px] rounded-xl border border-border bg-card p-5">
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

function RowShell({
	children,
	title,
	subtitle,
}: {
	children: (content: ReactNode) => ReactNode;
	title: string;
	subtitle: string;
}) {
	return children(
		<>
			<span className="min-w-0">
				<span className="block truncate text-[13.5px] font-medium text-foreground">
					{title}
				</span>
				<span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
					{subtitle}
				</span>
			</span>
			<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
		</>,
	);
}

const ROW_CLASS =
	"flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/60";

function ProjectRows({
	projects,
}: {
	projects: Array<{ id: string; title: string; status: string }>;
}) {
	if (projects.length === 0) {
		return (
			<EmptyPanel
				title="Start your first project"
				body="Describe what you need and a vetted consultant will scope it — roadmap, deliverables and terms before any work begins."
				cta={
					<Link
						to="/marketplace/project-posting"
						search={{ roadmapId: undefined }}
						className={CTA_CLASS}
					>
						Post a project
					</Link>
				}
			/>
		);
	}
	return (
		<div className="-mx-3">
			{projects.slice(0, 4).map((project) => (
				<RowShell
					key={project.id}
					title={project.title}
					subtitle={project.status}
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
		<div className="-mx-3">
			{engagements.slice(0, 4).map((engagement) => {
				const other =
					engagement.counterparty?.display_name_snapshot ?? "Counterparty";
				const kind =
					engagement.kind === "client_services" ? "Client" : "Talent";
				return (
					<RowShell
						key={engagement.id}
						title={
							engagement.viewer_position === "hirer"
								? `You hired ${other}`
								: `${other} hired you`
						}
						subtitle={`${kind} engagement · ${engagement.status}`}
					>
						{(content) => (
							<Link
								to="/marketplace/finance"
								search={{ tab: "engagements" }}
								className={ROW_CLASS}
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
					<Link
						to="/marketplace/finance"
						search={{ tab: "contracts" }}
						className={CTA_CLASS}
					>
						Go to contracts
					</Link>
				}
			/>
		);
	}
	return (
		<div className="-mx-3">
			{contracts.slice(0, 4).map((contract) => (
				<RowShell
					key={contract.id}
					title={contract.project_title_snapshot ?? "Untitled project"}
					subtitle={`${
						contract.contract_number ?? `Version ${contract.version}`
					} · ${contract.status}`}
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
