import { Link } from "@tanstack/react-router";
import { BadgeCheck, Check, Gauge } from "lucide-react";
import { SemanticBadge } from "@/components/common/SemanticBadge";
import {
	MeterBar,
	type MeterBarTone,
	meterBarTone,
	UsageMeter,
} from "@/components/common/UsageMeter";
import { WorkspaceSettingsGate } from "@/components/workspace/settings/WorkspaceSettingsGate";
import {
	useEntitlements,
	useWorkspaceUsageQuery,
} from "@/hooks/useEntitlements";
import { usePublicPlanLimits } from "@/hooks/usePlanLimits";
import {
	computeMeter,
	type RoadmapNodeUsage,
	usedFor,
	type WorkspaceUsage,
} from "@/lib/entitlements";
import {
	type CountKey,
	cellValue,
	formatCount,
	isEnabled,
	LIMIT_DEFINITIONS,
	type LimitCellMap,
	limitDefinition,
	nextPlanWith,
	type PlanId,
	planLabel,
} from "@/lib/planLimits";
import {
	COMPLIMENTARY_BADGE,
	featureAvailabilityCopy,
	meterCaption,
	pendingInvitesNote,
	planSummaryCopy,
	retentionCopy,
	type UpgradeCta,
	upgradeCta,
} from "@/lib/usageCopy";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/services/workspaces.service";

/** The card chrome every workspace settings page uses (see WorkspaceBillingPage). */
const CARD =
	"rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-(--app-shadow-sm) sm:p-6";
const KICKER =
	"text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground";

const CAPTION_TONE: Record<MeterBarTone, string> = {
	default: "text-muted-foreground",
	warning: "text-warning-foreground",
	danger: "text-destructive",
};

const COUNT_KEYS: readonly CountKey[] = ["members", "projects", "teams"];

/**
 * What this workspace's plan includes and how much of it is in use.
 *
 * Readable by every member — the usage endpoint answers any of them, so a
 * plain member never trips a 403 here. Only an owner can change the plan, so
 * only an owner gets the upgrade button; everyone else is pointed at one. A
 * complimentary workspace, or one already on the top plan, gets no call to
 * action at all.
 *
 * Every number comes from the server's usage payload (the effective plan's
 * live cells). The public matrix is read only to name the plan a missing
 * feature arrives on when the payload did not say.
 */
export function WorkspaceUsagePage() {
	return (
		<WorkspaceSettingsGate>
			{(workspace) => <UsageContent workspace={workspace} />}
		</WorkspaceSettingsGate>
	);
}

function UsageContent({ workspace }: { workspace: Workspace }) {
	const query = useWorkspaceUsageQuery(workspace.id);
	const entitlements = useEntitlements(workspace.id);
	const { limits: allLimits } = usePublicPlanLimits();

	return (
		<div className="app-fade-in">
			<header className="mb-8 flex items-start gap-4">
				<div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary sm:flex">
					<Gauge className="h-6 w-6" />
				</div>
				<div>
					<h1 className="text-3xl font-semibold tracking-tight text-foreground">
						Usage
					</h1>
					<p className="mt-2 max-w-2xl text-sm text-muted-foreground">
						What this workspace's plan includes, and how much of it is in use.
					</p>
				</div>
			</header>

			{entitlements.status === "ready" && entitlements.usage ? (
				<UsageBody
					workspace={workspace}
					usage={entitlements.usage}
					isComplimentary={entitlements.isComplimentary}
					allLimits={allLimits}
				/>
			) : entitlements.status === "loading" ? (
				<UsageSkeleton />
			) : (
				<section className={CARD}>
					<p className="text-sm text-muted-foreground">
						Usage is unavailable right now. Try again in a moment.
					</p>
					<button
						type="button"
						className="mt-4 inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
						disabled={query.isFetching}
						onClick={() => void query.refetch()}
					>
						Try again
					</button>
				</section>
			)}
		</div>
	);
}

function UsageBody({
	workspace,
	usage,
	isComplimentary,
	allLimits,
}: {
	workspace: Workspace;
	usage: WorkspaceUsage;
	isComplimentary: boolean;
	allLimits: Readonly<Partial<Record<PlanId, LimitCellMap>>>;
}) {
	const plan = usage.plan.effective;
	const until = usage.plan.complimentary?.until ?? null;
	const cta = upgradeCta({
		role: workspace.my_role,
		isComplimentary,
		upgradePlanName: usage.upgrade_plan,
	});

	return (
		<div className="space-y-6">
			<section className={CARD}>
				<p className={KICKER}>Current plan</p>
				<div className="mt-2 flex flex-wrap items-center gap-3">
					<p className="text-3xl font-semibold text-foreground">
						{planLabel(plan)}
					</p>
					{isComplimentary ? (
						<SemanticBadge icon={BadgeCheck} iconClassName="text-success">
							{COMPLIMENTARY_BADGE}
						</SemanticBadge>
					) : null}
				</div>
				<p className="mt-2 max-w-2xl text-sm text-muted-foreground">
					{planSummaryCopy({
						plan,
						isComplimentary,
						complimentaryUntil: until ? formatDate(until) : null,
						limits: usage.limits,
					})}
				</p>
				<UpgradeActions cta={cta} workspaceSlug={workspace.slug} />
			</section>

			<section aria-labelledby="usage-limits-heading">
				<h2
					id="usage-limits-heading"
					className="text-base font-semibold text-foreground"
				>
					Limits
				</h2>
				<div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
					{COUNT_KEYS.map((key) => (
						<CountMeterCard key={key} countKey={key} usage={usage} />
					))}
					<RoadmapNodesCard usage={usage} />
				</div>
			</section>

			<FeaturesCard usage={usage} allLimits={allLimits} />

			<section className={CARD}>
				<h2 className="text-base font-semibold text-foreground">
					Activity history
				</h2>
				<p className="mt-2 text-sm text-muted-foreground">
					{retentionCopy(usage.retention_days, plan)}
				</p>
			</section>
		</div>
	);
}

function UpgradeActions({
	cta,
	workspaceSlug,
}: {
	cta: UpgradeCta;
	workspaceSlug: string;
}) {
	if (cta.kind === "none") return null;
	if (cta.kind === "ask_owner") {
		return (
			<div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-5 text-sm">
				<p className="text-muted-foreground">{cta.label}</p>
				<Link
					to="/pricing"
					className="font-medium text-primary hover:underline"
				>
					Compare plans
				</Link>
			</div>
		);
	}
	return (
		<div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-5">
			<Link
				to="/w/$workspaceSlug/settings/billing"
				params={{ workspaceSlug }}
				className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-dark"
			>
				{cta.label}
			</Link>
			<Link
				to="/pricing"
				className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
			>
				Compare plans
			</Link>
		</div>
	);
}

function CountMeterCard({
	countKey,
	usage,
}: {
	countKey: CountKey;
	usage: WorkspaceUsage;
}) {
	const used = usedFor(usage, countKey);
	const limit = cellValue(usage.limits, countKey);
	const caption = meterCaption(
		countKey,
		computeMeter(used, limit),
		usage.plan.effective,
	);
	// Pending invites hold a member spot until they are answered, so the
	// member count says how many of the spots are invites.
	const pending =
		countKey === "members" && usage.counts_pending_invites
			? pendingInvitesNote(usage.usage.pending_invites)
			: null;
	const text = [caption, pending].filter(Boolean).join(" ");

	return (
		<div className={CARD}>
			<UsageMeter
				label={limitDefinition(countKey)?.label ?? countKey}
				used={used}
				limit={limit}
				caption={text || undefined}
			/>
		</div>
	);
}

function RoadmapNodesCard({ usage }: { usage: WorkspaceUsage }) {
	const limit = cellValue(usage.limits, "roadmap_nodes_per_roadmap");
	const { largest, near_limit: nearLimit } = usage.roadmaps;
	const others = nearLimit.filter(
		(roadmap) => roadmap.roadmap_id !== largest?.roadmap_id,
	);

	return (
		<div className={CARD}>
			<p className="text-sm font-medium text-foreground">
				Roadmap nodes per roadmap
			</p>
			<p className="mt-0.5 text-xs text-muted-foreground">
				Epics, features and tasks, counted on each roadmap separately.
			</p>

			{largest ? (
				<>
					<p className={cn(KICKER, "mt-4")}>Largest roadmap</p>
					<ul className="mt-2">
						<RoadmapMeterRow
							roadmap={largest}
							limit={limit}
							caption={meterCaption(
								"roadmap_nodes_per_roadmap",
								computeMeter(largest.nodes, limit),
								usage.plan.effective,
							)}
						/>
					</ul>
				</>
			) : (
				<p className="mt-4 text-sm text-muted-foreground">
					No roadmaps in this workspace yet.
				</p>
			)}

			{others.length > 0 ? (
				<>
					<p className={cn(KICKER, "mt-5")}>Also near the limit</p>
					<ul className="mt-2 space-y-3">
						{others.map((roadmap) => (
							<RoadmapMeterRow
								key={roadmap.roadmap_id}
								roadmap={roadmap}
								limit={limit}
							/>
						))}
					</ul>
				</>
			) : null}
		</div>
	);
}

/**
 * One roadmap against the per-roadmap limit. The name is null unless the
 * viewer can open that roadmap — workspace membership is not project access —
 * so an unnamed row says so and never links anywhere.
 */
function RoadmapMeterRow({
	roadmap,
	limit,
	caption,
}: {
	roadmap: RoadmapNodeUsage;
	limit: number | null;
	caption?: string | null;
}) {
	const meter = computeMeter(roadmap.nodes, limit);
	const tone = meterBarTone(meter.tone);
	const name = roadmap.name ?? "A roadmap you can't open";
	const reading =
		limit === null
			? `${formatCount(roadmap.nodes)} ${roadmap.nodes === 1 ? "node" : "nodes"}`
			: `${formatCount(roadmap.nodes)} of ${formatCount(limit)}`;

	return (
		<li>
			<div className="flex items-baseline justify-between gap-3 text-sm">
				<span className="min-w-0 truncate">
					{roadmap.name && roadmap.project_id ? (
						<Link
							to="/project/$projectId/roadmap/$roadmapId"
							params={{
								projectId: roadmap.project_id,
								roadmapId: roadmap.roadmap_id,
							}}
							className="font-medium text-foreground hover:text-primary hover:underline"
						>
							{roadmap.name}
						</Link>
					) : (
						<span
							className={
								roadmap.name
									? "font-medium text-foreground"
									: "text-muted-foreground"
							}
						>
							{name}
						</span>
					)}
					{roadmap.project_title ? (
						<span className="ml-2 text-xs text-muted-foreground">
							{roadmap.project_title}
						</span>
					) : null}
				</span>
				<span className="shrink-0 font-semibold tabular-nums text-foreground">
					{reading}
				</span>
			</div>
			{limit !== null ? (
				<MeterBar
					className="mt-1.5"
					percent={meter.percent}
					tone={tone}
					label={`${name}: ${reading} nodes`}
				/>
			) : null}
			{caption ? (
				<p className={cn("mt-1.5 text-xs", CAPTION_TONE[tone])}>{caption}</p>
			) : null}
		</li>
	);
}

interface FeatureLine {
	key: string;
	label: string;
	enabled: boolean;
	availableOn: PlanId | string | null;
}

/**
 * Only the features the backend actually enforces. The pricing-only ones
 * (SAML, activity export, …) change nothing in the product yet, so listing
 * them here would describe gates that do not exist.
 */
function enforcedFeatures(
	usage: WorkspaceUsage,
	allLimits: Readonly<Partial<Record<PlanId, LimitCellMap>>>,
): FeatureLine[] {
	const plan = usage.plan.effective;
	const fromServer = usage.features
		.filter(
			(item) =>
				item.enforced &&
				(limitDefinition(item.key)?.kind ?? "feature") === "feature",
		)
		.map((item) => ({
			key: item.key,
			label: item.label,
			enabled: item.enabled,
			availableOn: item.available_on as PlanId | null,
		}));
	// An older payload without the list still gets one, from the catalogue.
	const lines =
		fromServer.length > 0
			? fromServer
			: LIMIT_DEFINITIONS.filter(
					(definition) => definition.enforced && definition.kind === "feature",
				).map((definition) => ({
					key: definition.key,
					label: definition.label,
					enabled: isEnabled(usage.limits, definition.key),
					availableOn: null as PlanId | null,
				}));
	return lines.map((line) => ({
		...line,
		availableOn: line.enabled
			? null
			: (line.availableOn ?? nextPlanWith(line.key, plan, allLimits)),
	}));
}

function FeaturesCard({
	usage,
	allLimits,
}: {
	usage: WorkspaceUsage;
	allLimits: Readonly<Partial<Record<PlanId, LimitCellMap>>>;
}) {
	const features = enforcedFeatures(usage, allLimits);
	if (features.length === 0) return null;
	return (
		<section className={CARD}>
			<h2 className="text-base font-semibold text-foreground">Features</h2>
			<ul className="mt-2 divide-y divide-border">
				{features.map((feature) => (
					<li
						key={feature.key}
						className="flex items-center justify-between gap-4 py-3 text-sm"
					>
						<span className="min-w-0 text-foreground">{feature.label}</span>
						<span
							className={cn(
								"inline-flex shrink-0 items-center gap-1.5",
								feature.enabled
									? "font-medium text-foreground"
									: "text-muted-foreground",
							)}
						>
							{feature.enabled ? (
								<Check aria-hidden="true" className="h-4 w-4 text-success" />
							) : null}
							{featureAvailabilityCopy(feature.enabled, feature.availableOn)}
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}

function UsageSkeleton() {
	return (
		<div className="space-y-6" aria-busy="true">
			<p role="status" className="sr-only">
				Loading usage
			</p>
			<div className={cn(CARD, "animate-pulse")}>
				<div className="h-3 w-24 rounded bg-muted" />
				<div className="mt-3 h-8 w-32 rounded bg-muted" />
				<div className="mt-3 h-3 w-2/3 rounded bg-muted" />
			</div>
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				{[0, 1, 2, 3].map((index) => (
					<div key={index} className={cn(CARD, "animate-pulse")}>
						<div className="flex justify-between">
							<div className="h-3 w-20 rounded bg-muted" />
							<div className="h-3 w-12 rounded bg-muted" />
						</div>
						<div className="mt-3 h-1.5 w-full rounded-full bg-muted" />
						<div className="mt-3 h-3 w-1/2 rounded bg-muted" />
					</div>
				))}
			</div>
		</div>
	);
}

function formatDate(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return date.toLocaleDateString(undefined, {
		day: "numeric",
		month: "long",
		year: "numeric",
	});
}
