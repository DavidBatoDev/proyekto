import { Link } from "@tanstack/react-router";
import { CornerDownRight, Gavel, Link2Off, Lock } from "lucide-react";
import { RoadmapNodeGlyph } from "@/components/common/NodeGlyph";
import { CategoryChip } from "@/components/project/delivery/CategoryChip";
import { isOptimisticId } from "@/components/project/delivery/decisionCache";
import {
	DECISION_STATUS_LABEL,
	decisionLinkSegments,
	decisionReference,
	selectedOption,
} from "@/components/project/delivery/decisionModel";
import type { Decision } from "@/services/delivery.service";
import {
	DecisionButton,
	DecisionRailDot,
	DecisionStatusText,
} from "./DecisionPrimitives";

/**
 * One entry in the log.
 *
 * Hung off a continuous rail rather than boxed in a card: the rail is what makes
 * the page read as a history, and it carries the supersede thread, which is the
 * one relationship no other governance surface has.
 *
 * A superseded entry is dimmed rather than hidden. It is still the answer to
 * "what did we think in July", and deleting it from view would be rewriting the
 * record.
 */
export function DecisionEntry({
	decision,
	projectId,
	replacedTitle,
	isReplaced,
	canEdit,
	busy,
	onFinalize,
	last,
}: {
	decision: Decision;
	projectId: string;
	/** Title of the decision this one replaces, when it is also on screen. */
	replacedTitle: string | null;
	/** Whether a later decision on screen replaces this one. */
	isReplaced: boolean;
	canEdit: boolean;
	busy: boolean;
	onFinalize: () => void;
	/** Stops the rail short on the final entry so it doesn't dangle. */
	last: boolean;
}) {
	const saving = isOptimisticId(decision.id);
	const superseded = decision.status === "superseded";
	const chosen = selectedOption(decision);
	const links = decision.links ?? [];

	return (
		<article
			className={`relative flex gap-4 px-5 md:px-8 ${saving ? "opacity-60" : ""}`}
		>
			{/* The rail. A vertical hairline behind the dot, cut short on the last
			    entry so the line ends with the history rather than running off.
			    `bg-border` is too faint to read as a continuous line at 1px — it
			    resolves to about #eeeff1 on the page background — so the rail uses a
			    tinted foreground instead, which also tracks dark mode. */}
			<div className="relative flex w-2.5 shrink-0 justify-center">
				<span
					aria-hidden
					className={`absolute left-1/2 w-px -translate-x-1/2 bg-muted-foreground/25 ${
						last ? "top-0 h-5" : "inset-y-0"
					}`}
				/>
				<span className="relative mt-4">
					<DecisionRailDot status={decision.status} />
				</span>
			</div>

			<div
				className={`min-w-0 flex-1 py-3.5 ${superseded ? "opacity-60" : ""}`}
			>
				<div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
					<span className="font-mono text-[11px] text-muted-foreground">
						{decisionReference(decision)}
					</span>
					{saving ? (
						<span className="text-[15px] font-semibold text-foreground">
							{decision.title}
						</span>
					) : (
						<Link
							to="/project/$projectId/decisions/$decisionId"
							params={{ projectId, decisionId: decision.id }}
							className={`text-[15px] font-semibold text-foreground hover:text-primary ${
								superseded ? "line-through decoration-muted-foreground/40" : ""
							}`}
						>
							{decision.title}
						</Link>
					)}
					{decision.version > 1 && (
						<span className="text-[11px] text-muted-foreground">
							v{decision.version}
						</span>
					)}
					<DecisionStatusText
						status={decision.status}
						label={DECISION_STATUS_LABEL[decision.status]}
					/>
					{decision.visibility === "internal" && (
						<span
							className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
							title="Internal — not shared with everyone on the project"
						>
							<Lock className="h-3 w-3" />
							Internal
						</span>
					)}
				</div>

				{/* The ruling itself, at reading size. */}
				<p className="mt-1 max-w-2xl text-sm leading-relaxed text-foreground">
					{decision.decision}
				</p>

				<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
					<CategoryChip category={decision.category} size="sm" />

					{chosen && (
						<span className="text-[11px] text-muted-foreground">
							chose{" "}
							<strong className="font-medium text-foreground">
								{chosen.title}
							</strong>
							{(decision.options?.length ?? 0) > 1 &&
								` over ${(decision.options?.length ?? 1) - 1} other${
									(decision.options?.length ?? 1) - 1 === 1 ? "" : "s"
								}`}
						</span>
					)}

					{links.length > 0 ? (
						<span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
							{(() => {
								const leaf = decisionLinkSegments(links[0]).at(-1);
								return leaf ? (
									<>
										<RoadmapNodeGlyph kind={leaf.kind} size={11} />
										<span className="truncate">{leaf.title}</span>
										{links.length > 1 && <span>+{links.length - 1}</span>}
									</>
								) : null;
							})()}
						</span>
					) : (
						!superseded && (
							<span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
								<Link2Off className="h-3 w-3" />
								not linked to any work
							</span>
						)
					)}

					<span className="text-[11px] tabular-nums text-muted-foreground/70">
						{decision.decided_on}
					</span>

					{canEdit && decision.status === "proposed" && !saving && (
						<DecisionButton tone="solid" onClick={onFinalize} disabled={busy}>
							<Gavel className="h-3 w-3" />
							Mark final
						</DecisionButton>
					)}
				</div>

				{/* The supersede thread — drawn only when both ends are on screen. */}
				{replacedTitle && (
					<p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
						<CornerDownRight className="h-3 w-3 shrink-0" />
						replaces <span className="italic">{replacedTitle}</span>
					</p>
				)}
				{isReplaced && (
					<p className="mt-2 text-[11px] text-muted-foreground">
						superseded by a later decision
					</p>
				)}
			</div>
		</article>
	);
}
