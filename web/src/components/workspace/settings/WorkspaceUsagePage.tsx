import { Link } from "@tanstack/react-router";
import {
	AlertTriangle,
	BadgeCheck,
	Check,
	FolderKanban,
	History,
	Lock,
	type LucideIcon,
	Map as MapIcon,
	UserRound,
	Users,
} from "lucide-react";
import { SemanticBadge } from "@/components/common/SemanticBadge";
import {
	MeterBar,
	MeterCaption,
	meterBarTone,
	Reading,
	type ReadingSize,
	USAGE_TRACK,
	UsageMeterDetail,
	UsageReading,
} from "@/components/common/UsageMeter";
import {
	SettingsHeadline,
	SettingsNotice,
	SettingsPageHeader,
	SettingsRow,
	SettingsRows,
	SettingsSection,
	SettingsSkeleton,
	settingsButton,
} from "@/components/workspace/settings/SettingsPrimitives";
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
	countNoun,
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

/** A row's leading icon; the row centres it on the label's line. */
const ROW_ICON = "h-4 w-4 shrink-0 text-muted-foreground";

const COUNT_ROWS: readonly { key: CountKey; icon: LucideIcon }[] = [
	{ key: "members", icon: UserRound },
	{ key: "projects", icon: FolderKanban },
	{ key: "teams", icon: Users },
];

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
			<SettingsPageHeader
				title="Usage"
				description="What this workspace's plan includes, and how much of it is in use."
			/>

			{entitlements.status === "ready" && entitlements.usage ? (
				<UsageBody
					workspace={workspace}
					usage={entitlements.usage}
					isComplimentary={entitlements.isComplimentary}
					allLimits={allLimits}
				/>
			) : entitlements.status === "loading" ? (
				<SettingsSkeleton bands={4} label="Loading usage" />
			) : (
				<div className="py-8">
					<SettingsNotice
						tone="warning"
						icon={AlertTriangle}
						action={
							<button
								type="button"
								className={settingsButton.secondary}
								disabled={query.isFetching}
								onClick={() => void query.refetch()}
							>
								Try again
							</button>
						}
					>
						Usage is unavailable right now. Try again in a moment.
					</SettingsNotice>
				</div>
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
		<div>
			<SettingsSection
				id="usage-plan"
				title="Plan"
				description="What this workspace is on today."
			>
				<SettingsHeadline
					value={planLabel(plan)}
					badge={
						isComplimentary ? (
							<SemanticBadge icon={BadgeCheck} iconClassName="text-success">
								{COMPLIMENTARY_BADGE}
							</SemanticBadge>
						) : null
					}
				>
					{planSummaryCopy({
						plan,
						isComplimentary,
						complimentaryUntil: until ? formatDate(until) : null,
						limits: usage.limits,
					})}
				</SettingsHeadline>
				<UpgradeActions cta={cta} workspaceSlug={workspace.slug} />
			</SettingsSection>

			<SettingsSection
				id="usage-limits"
				title="Limits"
				description="Counted across this workspace. A limit only blocks new additions; everything you have stays."
			>
				<SettingsRows as="ul">
					{COUNT_ROWS.map((row) => (
						<CountRow
							key={row.key}
							countKey={row.key}
							icon={row.icon}
							usage={usage}
						/>
					))}
					<RoadmapNodesRow usage={usage} />
				</SettingsRows>
			</SettingsSection>

			<FeaturesSection usage={usage} allLimits={allLimits} />

			<SettingsSection
				id="usage-activity"
				title="Activity history"
				description="How much past activity this workspace shows."
			>
				<SettingsRows>
					<SettingsRow
						inline
						label="Visible history"
						description={retentionCopy(usage.retention_days, plan)}
						leading={<History aria-hidden="true" className={ROW_ICON} />}
					>
						<RetentionValue days={usage.retention_days} />
					</SettingsRow>
				</SettingsRows>
			</SettingsSection>
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
	// Everything that is not an owner-with-somewhere-to-buy renders as text.
	// Written as the negation of "upgrade" rather than a list of the others so
	// a new UpgradeCta member cannot fall through into the buy button below.
	// (This page is a commerce surface and never renders in the installed app;
	// this is here so the types stay honest.)
	if (cta.kind !== "upgrade") {
		return (
			<div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
				<p className="text-sm text-muted-foreground">{cta.label}</p>
				<Link to="/pricing" className={settingsButton.link}>
					Compare plans
				</Link>
			</div>
		);
	}
	return (
		<div className="mt-5 flex flex-wrap items-center gap-2">
			<Link
				to="/w/$workspaceSlug/settings/billing"
				params={{ workspaceSlug }}
				className={settingsButton.primary}
			>
				{cta.label}
			</Link>
			<Link to="/pricing" className={settingsButton.secondary}>
				Compare plans
			</Link>
		</div>
	);
}

function CountRow({
	countKey,
	icon: Icon,
	usage,
}: {
	countKey: CountKey;
	icon: LucideIcon;
	usage: WorkspaceUsage;
}) {
	const label = limitDefinition(countKey)?.label ?? countKey;
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
	// With no ceiling there is no bar, so the caption reads as the row's
	// description rather than floating under an empty gap.
	const finite = limit !== null;

	return (
		<SettingsRow
			as="li"
			inline
			label={label}
			leading={<Icon aria-hidden="true" className={ROW_ICON} />}
			description={!finite && text ? text : undefined}
			below={
				finite ? (
					<UsageMeterDetail
						label={label}
						used={used}
						limit={limit}
						caption={text || undefined}
					/>
				) : undefined
			}
		>
			<UsageReading used={used} limit={limit} size="lg" />
		</SettingsRow>
	);
}

/** "240 of 250" against a limit, "240 nodes" with none. */
function nodesReading(nodes: number, limit: number | null): string {
	return limit === null
		? `${formatCount(nodes)} ${nodes === 1 ? "node" : "nodes"}`
		: `${formatCount(nodes)} of ${formatCount(limit)}`;
}

/** The same reading, drawn with a strong figure and a quiet qualifier. */
function NodesReading({
	nodes,
	limit,
	size,
}: {
	nodes: number;
	limit: number | null;
	size: ReadingSize;
}) {
	return (
		<Reading
			size={size}
			figure={formatCount(nodes)}
			qualifier={
				limit === null
					? nodes === 1
						? "node"
						: "nodes"
					: `of ${formatCount(limit)}`
			}
		/>
	);
}

/**
 * The per-roadmap limit, read off the workspace's largest roadmap. Roadmaps
 * that are also close to it hang under that one as compact sub-rows.
 *
 * Every caption line (what is counted, which roadmap is largest and, with no
 * ceiling, the plan's line) sits in the row's description as one tight stack,
 * the rhythm the other rows' captions keep. Only the bar and the caption
 * that reads it hang below, and only against a finite limit, as on the count
 * rows.
 */
function RoadmapNodesRow({ usage }: { usage: WorkspaceUsage }) {
	const limit = cellValue(usage.limits, "roadmap_nodes_per_roadmap");
	const { largest, near_limit: nearLimit } = usage.roadmaps;
	const others = nearLimit.filter(
		(roadmap) => roadmap.roadmap_id !== largest?.roadmap_id,
	);
	const meter = largest ? computeMeter(largest.nodes, limit) : null;
	const tone = meter ? meterBarTone(meter.tone) : "default";
	const caption = meter
		? meterCaption("roadmap_nodes_per_roadmap", meter, usage.plan.effective)
		: null;
	const bar = largest && meter && limit !== null;

	return (
		<SettingsRow
			as="li"
			inline
			label="Roadmap nodes per roadmap"
			description={
				<>
					<span className="block">
						Epics, features and tasks, counted on each roadmap separately.
					</span>
					{largest ? (
						<LargestRoadmapLine roadmap={largest} />
					) : (
						<span className="mt-0.5 block">
							No roadmaps in this workspace yet.
						</span>
					)}
					{largest && !bar && caption ? (
						<MeterCaption tone={tone} className="mt-0.5">
							{caption}
						</MeterCaption>
					) : null}
				</>
			}
			leading={<MapIcon aria-hidden="true" className={ROW_ICON} />}
			below={
				bar || others.length > 0 ? (
					<div>
						{bar ? (
							<>
								<MeterBar
									className={USAGE_TRACK}
									percent={meter.percent}
									tone={tone}
									label={`${largest.name ?? "A roadmap you can't open"}: ${nodesReading(largest.nodes, limit)} nodes`}
								/>
								{caption ? (
									<MeterCaption tone={tone} className="mt-2">
										{caption}
									</MeterCaption>
								) : null}
							</>
						) : null}
						{others.length > 0 ? (
							<div className={bar ? "mt-5" : undefined}>
								<p className="text-xs font-medium text-muted-foreground">
									Also near the limit
								</p>
								<ul className="mt-2.5 space-y-3 border-l border-border pl-4">
									{others.map((roadmap) => (
										<NearLimitRoadmap
											key={roadmap.roadmap_id}
											roadmap={roadmap}
											limit={limit}
										/>
									))}
								</ul>
							</div>
						) : null}
					</div>
				) : undefined
			}
		>
			{largest ? (
				<NodesReading nodes={largest.nodes} limit={limit} size="lg" />
			) : null}
		</SettingsRow>
	);
}

/**
 * A roadmap's name. It is null unless the viewer can open that roadmap —
 * workspace membership is not project access — so an unnamed roadmap says so
 * and never links anywhere, and a named one links only when it has a project
 * to open it in.
 */
function RoadmapName({ roadmap }: { roadmap: RoadmapNodeUsage }) {
	if (roadmap.name && roadmap.project_id) {
		return (
			<Link
				to="/project/$projectId/roadmap/$roadmapId"
				params={{
					projectId: roadmap.project_id,
					roadmapId: roadmap.roadmap_id,
				}}
				className="text-xs font-medium text-foreground hover:text-primary hover:underline"
			>
				{roadmap.name}
			</Link>
		);
	}
	if (roadmap.name) {
		return (
			<span className="text-xs font-medium text-foreground">
				{roadmap.name}
			</span>
		);
	}
	return (
		<span className="text-xs text-muted-foreground">
			A roadmap you can't open
		</span>
	);
}

/**
 * "Largest roadmap · <name> · <project>", a line of the row's description.
 * It inherits the description's size and line height, so it stacks as
 * tightly as the line above it.
 */
function LargestRoadmapLine({ roadmap }: { roadmap: RoadmapNodeUsage }) {
	return (
		<span className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5">
			<span>Largest roadmap</span>
			<span aria-hidden="true">·</span>
			<RoadmapName roadmap={roadmap} />
			{roadmap.project_title ? (
				<>
					<span aria-hidden="true">·</span>
					<span>{roadmap.project_title}</span>
				</>
			) : null}
		</span>
	);
}

function NearLimitRoadmap({
	roadmap,
	limit,
}: {
	roadmap: RoadmapNodeUsage;
	limit: number | null;
}) {
	const meter = computeMeter(roadmap.nodes, limit);
	const reading = nodesReading(roadmap.nodes, limit);

	return (
		<li>
			<div className="flex items-baseline justify-between gap-3">
				<span className="min-w-0 truncate text-xs">
					<RoadmapName roadmap={roadmap} />
					{roadmap.project_title ? (
						<span className="ml-1.5 text-muted-foreground">
							{roadmap.project_title}
						</span>
					) : null}
				</span>
				<NodesReading nodes={roadmap.nodes} limit={limit} size="sm" />
			</div>
			{limit !== null ? (
				<MeterBar
					className={cn("mt-1.5 h-1", USAGE_TRACK)}
					percent={meter.percent}
					tone={meterBarTone(meter.tone)}
					label={`${roadmap.name ?? "A roadmap you can't open"}: ${reading} nodes`}
				/>
			) : null}
		</li>
	);
}

function RetentionValue({ days }: { days: number | null }) {
	// Spelled out with no ∞ beside it, as every unlimited reading is.
	if (days === null) return <Reading size="lg" figure="Unlimited" />;
	// "90 days": the figure strong, the unit quiet, the wording still
	// countNoun's own.
	const [figure, ...unit] = countNoun("activity_retention_days", days).split(
		" ",
	);
	return <Reading size="lg" figure={figure} qualifier={unit.join(" ")} />;
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

function FeaturesSection({
	usage,
	allLimits,
}: {
	usage: WorkspaceUsage;
	allLimits: Readonly<Partial<Record<PlanId, LimitCellMap>>>;
}) {
	const features = enforcedFeatures(usage, allLimits);
	if (features.length === 0) return null;
	return (
		<SettingsSection
			id="usage-features"
			title="Features"
			description="What this plan turns on, and which plan brings the rest."
		>
			<ul className="grid gap-x-8 gap-y-3.5 sm:grid-cols-2">
				{features.map((feature) => {
					const availability = featureAvailabilityCopy(
						feature.enabled,
						feature.availableOn,
					);
					return (
						<li key={feature.key} className="flex min-w-0 items-start gap-3">
							{feature.enabled ? (
								<Check
									aria-hidden="true"
									className="mt-0.5 h-4 w-4 shrink-0 text-success"
								/>
							) : (
								<Lock
									aria-hidden="true"
									className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
								/>
							)}
							<div className="min-w-0">
								<p
									className={cn(
										"text-sm leading-5",
										feature.enabled
											? "text-foreground"
											: "text-muted-foreground",
									)}
								>
									{feature.label}
								</p>
								{/* The check already says "included" to the eye; only a
								    missing feature needs a visible line saying where it is. */}
								<p
									className={
										feature.enabled
											? "sr-only"
											: "mt-0.5 text-xs text-muted-foreground"
									}
								>
									{availability}
								</p>
							</div>
						</li>
					);
				})}
			</ul>
		</SettingsSection>
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
