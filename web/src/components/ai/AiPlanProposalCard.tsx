import type { FC } from "react";
import type { AgentPlanProposal } from "@/services/ai-agent.service";
import { AiPlanProposalGraph } from "./AiPlanProposalGraph";

export interface AiPlanProposalCardProps {
	plan: AgentPlanProposal;
	onApply: () => void;
	onDiscard: () => void;
	disabled?: boolean;
}

const SectionTitle: FC<{ children: React.ReactNode }> = ({ children }) => (
	<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
		{children}
	</div>
);

export const AiPlanProposalCard: FC<AiPlanProposalCardProps> = ({
	plan,
	onApply,
	onDiscard,
	disabled,
}) => {
	const isConfirmed = plan.status === "confirmed";
	const isDiscarded =
		plan.status === "discarded" || plan.status === "superseded";
	const isSettled = isConfirmed || isDiscarded;
	// Run-era proposals carry one target per roadmap; `proposed_hierarchy`
	// above mirrors only `targets[0]`, so a multi-roadmap proposal (or an
	// `edits` proposal with the agent's per-operation summary lines) lists
	// every target here. Legacy single-roadmap plans have no targets.
	const targets = plan.targets ?? [];
	const showTargets =
		targets.length > 1 ||
		targets.some((target) => (target.summary_lines?.length ?? 0) > 0);

	return (
		<div className="mt-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
			<div className="mb-2 flex items-center gap-2">
				<span className="inline-flex rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
					Plan proposal
				</span>
				{isConfirmed ? (
					<span className="text-xs text-success-foreground">Applied</span>
				) : null}
				{isDiscarded ? (
					<span className="text-xs text-muted-foreground">Discarded</span>
				) : null}
			</div>

			<div className="space-y-3">
				{plan.goal ? (
					<div>
						<SectionTitle>Goal</SectionTitle>
						<div className="text-sm text-foreground">{plan.goal}</div>
					</div>
				) : null}

				{plan.rationale ? (
					<div>
						<SectionTitle>Rationale</SectionTitle>
						<div className="text-sm text-muted-foreground">
							{plan.rationale}
						</div>
					</div>
				) : null}

				{showTargets ? (
					<div>
						<SectionTitle>
							{targets.length > 1 ? `Roadmaps (${targets.length})` : "Changes"}
						</SectionTitle>
						<ul className="mt-1 space-y-2" data-testid="ai-plan-targets">
							{targets.map((target, idx) => (
								<li
									key={target.roadmap_id || `target-${idx}`}
									className="rounded-md border border-border bg-card/60 px-2.5 py-2 text-sm"
									data-roadmap-id={target.roadmap_id}
								>
									<div className="flex flex-wrap items-center gap-2">
										<span className="font-medium text-foreground">
											{target.roadmap_title || "Roadmap"}
										</span>
										{typeof target.operations_count === "number" ? (
											<span className="text-xs text-muted-foreground">
												{target.operations_count}{" "}
												{target.operations_count === 1 ? "change" : "changes"}
											</span>
										) : null}
										{target.contains_delete ? (
											<span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
												Includes deletes
											</span>
										) : null}
										{target.committed ? (
											<span className="text-xs text-muted-foreground">
												Applied
											</span>
										) : null}
									</div>
									{target.summary_lines && target.summary_lines.length > 0 ? (
										<ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
											{target.summary_lines.map((line, lineIdx) => (
												<li key={`line-${lineIdx}`}>{line}</li>
											))}
										</ul>
									) : null}
								</li>
							))}
						</ul>
					</div>
				) : null}

				{plan.proposed_hierarchy && plan.proposed_hierarchy.length > 0 ? (
					<div>
						<SectionTitle>
							{targets.length > 1
								? `Proposed structure (${targets[0]?.roadmap_title || "first roadmap"})`
								: "Proposed structure"}
						</SectionTitle>
						<div className="mt-1">
							<AiPlanProposalGraph epics={plan.proposed_hierarchy} />
						</div>
					</div>
				) : null}

				{plan.risks && plan.risks.length > 0 ? (
					<div>
						<SectionTitle>Risks</SectionTitle>
						<ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
							{plan.risks.map((risk, idx) => (
								<li key={`risk-${idx}`}>{risk}</li>
							))}
						</ul>
					</div>
				) : null}

				{plan.next_steps && plan.next_steps.length > 0 ? (
					<div>
						<SectionTitle>Next steps</SectionTitle>
						<ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
							{plan.next_steps.map((step, idx) => (
								<li key={`next-${idx}`}>{step}</li>
							))}
						</ul>
					</div>
				) : null}
			</div>

			{!isSettled ? (
				<div className="mt-3 flex items-center gap-2 border-t border-primary/20 pt-2">
					<button
						type="button"
						onClick={onApply}
						disabled={disabled}
						className="ai-gradient-bg inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
					>
						Apply this plan
					</button>
					<button
						type="button"
						onClick={onDiscard}
						disabled={disabled}
						className="inline-flex items-center rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
					>
						Discard plan
					</button>
				</div>
			) : null}
		</div>
	);
};
