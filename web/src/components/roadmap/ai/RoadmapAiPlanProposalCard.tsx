import type { FC } from "react";
import type {
  AgentPlanProposal,
  AgentPlanProposalEpic,
  AgentPlanProposalFeature,
  AgentPlanProposalTask,
} from "@/services/roadmap-agent.service";

export interface RoadmapAiPlanProposalCardProps {
  plan: AgentPlanProposal;
  onApply: () => void;
  onDiscard: () => void;
  disabled?: boolean;
}

const SectionTitle: FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
    {children}
  </div>
);

const TaskRow: FC<{ task: AgentPlanProposalTask }> = ({ task }) => (
  <li className="ml-4 list-disc text-sm text-neutral-700 dark:text-neutral-300">
    <span className="font-medium">{task.title}</span>
    {task.target_feature_title ? (
      <span className="text-neutral-500"> (under existing "{task.target_feature_title}")</span>
    ) : null}
    {task.description ? (
      <span className="text-neutral-500"> — {task.description}</span>
    ) : null}
  </li>
);

const FeatureRow: FC<{ feature: AgentPlanProposalFeature }> = ({ feature }) => (
  <li className="ml-3 list-disc text-sm text-neutral-800 dark:text-neutral-200">
    <div>
      <span className="font-medium">{feature.title}</span>
      {feature.target_epic_title ? (
        <span className="text-neutral-500"> (under existing "{feature.target_epic_title}")</span>
      ) : null}
      {feature.description ? (
        <span className="text-neutral-500"> — {feature.description}</span>
      ) : null}
    </div>
    {feature.tasks && feature.tasks.length > 0 ? (
      <ul className="mt-1 space-y-0.5">
        {feature.tasks.map((task, idx) => (
          <TaskRow key={`${feature.title}-task-${idx}`} task={task} />
        ))}
      </ul>
    ) : null}
  </li>
);

const EpicRow: FC<{ epic: AgentPlanProposalEpic }> = ({ epic }) => (
  <li className="list-disc text-sm text-neutral-900 dark:text-neutral-100">
    <div>
      <span className="font-semibold">{epic.title}</span>
      {epic.description ? (
        <span className="text-neutral-500"> — {epic.description}</span>
      ) : null}
    </div>
    {epic.features && epic.features.length > 0 ? (
      <ul className="mt-1 space-y-1">
        {epic.features.map((feature, idx) => (
          <FeatureRow key={`${epic.title}-feature-${idx}`} feature={feature} />
        ))}
      </ul>
    ) : null}
  </li>
);

export const RoadmapAiPlanProposalCard: FC<RoadmapAiPlanProposalCardProps> = ({
  plan,
  onApply,
  onDiscard,
  disabled,
}) => {
  const isConfirmed = plan.status === "confirmed";
  const isDiscarded = plan.status === "discarded" || plan.status === "superseded";
  const isSettled = isConfirmed || isDiscarded;

  return (
    <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex rounded-full bg-blue-200 px-2 py-0.5 text-xs font-semibold text-blue-900 dark:bg-blue-800 dark:text-blue-100">
          Plan proposal
        </span>
        {isConfirmed ? (
          <span className="text-xs text-emerald-700 dark:text-emerald-400">Applied</span>
        ) : null}
        {isDiscarded ? (
          <span className="text-xs text-neutral-500">Discarded</span>
        ) : null}
      </div>

      <div className="space-y-3">
        {plan.goal ? (
          <div>
            <SectionTitle>Goal</SectionTitle>
            <div className="text-sm text-neutral-800 dark:text-neutral-200">{plan.goal}</div>
          </div>
        ) : null}

        {plan.rationale ? (
          <div>
            <SectionTitle>Rationale</SectionTitle>
            <div className="text-sm text-neutral-700 dark:text-neutral-300">{plan.rationale}</div>
          </div>
        ) : null}

        {plan.proposed_hierarchy && plan.proposed_hierarchy.length > 0 ? (
          <div>
            <SectionTitle>Proposed structure</SectionTitle>
            <ul className="mt-1 space-y-1.5 pl-5">
              {plan.proposed_hierarchy.map((epic, idx) => (
                <EpicRow key={`epic-${idx}`} epic={epic} />
              ))}
            </ul>
          </div>
        ) : null}

        {plan.risks && plan.risks.length > 0 ? (
          <div>
            <SectionTitle>Risks</SectionTitle>
            <ul className="mt-1 list-disc pl-5 text-sm text-neutral-700 dark:text-neutral-300">
              {plan.risks.map((risk, idx) => (
                <li key={`risk-${idx}`}>{risk}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {plan.next_steps && plan.next_steps.length > 0 ? (
          <div>
            <SectionTitle>Next steps</SectionTitle>
            <ul className="mt-1 list-disc pl-5 text-sm text-neutral-700 dark:text-neutral-300">
              {plan.next_steps.map((step, idx) => (
                <li key={`next-${idx}`}>{step}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {plan.open_questions && plan.open_questions.length > 0 ? (
          <div>
            <SectionTitle>Open questions</SectionTitle>
            <ul className="mt-1 list-disc pl-5 text-sm text-amber-800 dark:text-amber-300">
              {plan.open_questions.map((question, idx) => (
                <li key={`q-${idx}`}>{question}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {!isSettled ? (
        <div className="mt-3 flex items-center gap-2 border-t border-blue-200 pt-2 dark:border-blue-900">
          <button
            type="button"
            onClick={onApply}
            disabled={disabled}
            className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            Apply this plan
          </button>
          <button
            type="button"
            onClick={onDiscard}
            disabled={disabled}
            className="inline-flex items-center rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            Discard plan
          </button>
        </div>
      ) : null}
    </div>
  );
};
