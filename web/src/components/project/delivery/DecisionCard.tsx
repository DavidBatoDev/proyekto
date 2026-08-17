import { Link } from "@tanstack/react-router";
import {
	ArrowUpDown,
	CircleCheck,
	Gavel,
	Link2Off,
	ListTree,
	Lock,
} from "lucide-react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import type { Decision } from "@/services/delivery.service";
import { CategoryChip } from "./CategoryChip";
import {
	PrimaryButton,
	RoadmapNodeGlyph,
	SecondaryButton,
	StatusPill,
} from "./DeliveryPrimitives";
import { isOptimisticId } from "./decisionCache";
import {
	DECISION_STATUS_LABEL,
	DECISION_STATUS_TONE,
	daysOpen,
	decisionLinkSegments,
	decisionReference,
	selectedOption,
} from "./decisionModel";

/** Two links is what fits; the rest are one click away on the detail page. */
const LINKS_PREVIEW = 2;

/** Rail colours mirror the status tones so a stack scans without reading pills. */
const STATUS_RAIL: Record<Decision["status"], string> = {
	proposed: "bg-warning",
	final: "bg-success",
	superseded: "bg-muted-foreground/40",
};

export interface DecisionCardActions {
	canEdit: boolean;
	busy: boolean;
	onFinalize: () => void;
	onSupersede: () => void;
}

/**
 * One decision, at a fixed height.
 *
 * Every card in the stack is the same height whatever it holds, so the list
 * scans as a list — the same rule the deliverable card follows. A decision with
 * six options and one with none produce the same row; the overflow is clamped
 * and the detail page is where the whole of it lives.
 */
export function DecisionCard({
	decision,
	projectId,
	actions,
}: {
	decision: Decision;
	projectId: string;
	actions: DecisionCardActions;
}) {
	// A temp row has no server id, so the detail route would 404 on it.
	const saving = isOptimisticId(decision.id);
	const superseded = decision.status === "superseded";
	const proposed = decision.status === "proposed";

	const links = decision.links ?? [];
	const options = decision.options ?? [];
	const chosen = selectedOption(decision);

	return (
		// A flex column rather than a fixed block with an absolute footer: the
		// height is only pinned from `lg` up, and below that an absolute footer
		// would sit on top of the last row of the body.
		<AppSurfaceCard
			className={`relative flex flex-col overflow-hidden p-4 pl-5 transition-colors hover:border-primary/30 lg:h-[11.5rem] ${
				superseded ? "opacity-70" : ""
			} ${saving ? "pointer-events-none opacity-60" : ""}`}
		>
			<span
				aria-hidden
				className={`absolute inset-y-0 left-0 w-1 ${STATUS_RAIL[decision.status]}`}
			/>

			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<span className="font-mono text-[11px] font-semibold text-muted-foreground">
							{decisionReference(decision)}
						</span>
						<CategoryChip category={decision.category} size="sm" />
						<StatusPill
							label={DECISION_STATUS_LABEL[decision.status]}
							tone={DECISION_STATUS_TONE[decision.status]}
						/>
						{decision.version > 1 && (
							<span className="text-[11px] text-muted-foreground">
								v{decision.version}
							</span>
						)}
						{decision.visibility === "internal" && (
							<span
								className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground"
								title="Internal — not shared with everyone on the project"
							>
								<Lock className="h-3 w-3" />
								Internal
							</span>
						)}
					</div>

					{saving ? (
						<span className="mt-1 block text-sm font-semibold text-foreground">
							{decision.title}
						</span>
					) : (
						<Link
							to="/project/$projectId/decisions/$decisionId"
							params={{ projectId, decisionId: decision.id }}
							className="mt-1 block truncate text-sm font-semibold text-foreground hover:text-primary"
						>
							{decision.title}
						</Link>
					)}
				</div>

				<div className="flex shrink-0 items-center gap-2">
					{saving && (
						<span className="text-xs text-muted-foreground">Saving…</span>
					)}
					{!saving && proposed && actions.canEdit && (
						<PrimaryButton onClick={actions.onFinalize} disabled={actions.busy}>
							<Gavel className="h-4 w-4" />
							Mark final
						</PrimaryButton>
					)}
					{!saving && !superseded && !proposed && actions.canEdit && (
						<SecondaryButton
							onClick={actions.onSupersede}
							disabled={actions.busy}
						>
							<ArrowUpDown className="h-3.5 w-3.5" />
							Supersede
						</SecondaryButton>
					)}
				</div>
			</div>

			<div className="mt-3 grid flex-1 items-start gap-x-8 gap-y-3 overflow-hidden lg:grid-cols-3">
				{/* 1 — what was decided */}
				<div className="min-w-0">
					<p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
						The decision
					</p>
					<p className="line-clamp-3 text-sm text-foreground">
						{decision.decision}
					</p>
				</div>

				{/* 2 — why */}
				<div className="min-w-0">
					<p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
						Why
					</p>
					{decision.rationale ? (
						<p className="line-clamp-3 text-sm text-muted-foreground">
							{decision.rationale}
						</p>
					) : (
						<p className="text-sm text-muted-foreground/70">
							No reasoning recorded.
						</p>
					)}
				</div>

				{/* 3 — what it touches */}
				<div className="min-w-0">
					<p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
						Affects
					</p>
					{links.length === 0 ? (
						<p className="flex items-center gap-1.5 text-sm text-muted-foreground/70">
							<Link2Off className="h-3.5 w-3.5 shrink-0" />
							Nothing linked yet
						</p>
					) : (
						<ul className="flex flex-col gap-1">
							{links.slice(0, LINKS_PREVIEW).map((link) => {
								const segments = decisionLinkSegments(link);
								const leaf = segments.at(-1);
								if (!leaf) return null;
								return (
									<li
										key={link.id}
										className="flex items-center gap-1.5 text-xs text-foreground"
									>
										<RoadmapNodeGlyph kind={leaf.kind} size={12} />
										<span className="truncate">{leaf.title}</span>
									</li>
								);
							})}
							{links.length > LINKS_PREVIEW && (
								<li>
									<Link
										to="/project/$projectId/decisions/$decisionId"
										params={{ projectId, decisionId: decision.id }}
										search={{ tab: "impact" }}
										className="text-xs font-semibold text-primary hover:underline"
									>
										+{links.length - LINKS_PREVIEW} more
									</Link>
								</li>
							)}
						</ul>
					)}
				</div>
			</div>

			{/* Footer strip: the choice, the count, and when it was settled. */}
			{/* Negative margins pull it to the card's edges so the rule spans the
			    full width, then pl-5 puts its text back in line with the body. */}
			<div className="-ml-5 -mr-4 -mb-4 mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 py-2 pl-5 pr-4 text-[11px] text-muted-foreground">
				{chosen ? (
					<span className="inline-flex min-w-0 items-center gap-1.5">
						<CircleCheck className="h-3.5 w-3.5 shrink-0 text-success" />
						<span className="truncate">
							Chose <strong className="font-semibold">{chosen.title}</strong>
							{options.length > 1 && ` over ${options.length - 1} other`}
							{options.length > 2 && "s"}
						</span>
					</span>
				) : options.length > 0 ? (
					<Link
						to="/project/$projectId/decisions/$decisionId"
						params={{ projectId, decisionId: decision.id }}
						search={{ tab: "options" }}
						className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
					>
						<ListTree className="h-3.5 w-3.5" />
						{options.length} options, none marked
					</Link>
				) : null}

				<span className="ml-auto shrink-0">
					{proposed
						? `Open ${daysOpen(decision)} day${daysOpen(decision) === 1 ? "" : "s"}`
						: `Decided ${decision.decided_on}`}
				</span>
			</div>
		</AppSurfaceCard>
	);
}
