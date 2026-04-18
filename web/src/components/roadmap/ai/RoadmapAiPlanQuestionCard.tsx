import { useState } from "react";
import type { FC } from "react";
import type {
  AgentPlanProposal,
  AgentPlanProposalAnswer,
  AgentPlanProposalQuestion,
} from "@/services/roadmap-agent.service";

export interface RoadmapAiPlanQuestionCardProps {
  plan: AgentPlanProposal;
  onSubmit: (answer: AgentPlanProposalAnswer) => void;
  onDiscard: () => void;
  disabled?: boolean;
}

const CUSTOM_SENTINEL = "__custom__";

export const RoadmapAiPlanQuestionCard: FC<RoadmapAiPlanQuestionCardProps> = ({
  plan,
  onSubmit,
  onDiscard,
  disabled,
}) => {
  const question: AgentPlanProposalQuestion | null | undefined =
    plan.current_question;
  const [selection, setSelection] = useState<string>("");
  const [customText, setCustomText] = useState<string>("");

  if (!question) return null;

  const allowCustom = question.allow_custom !== false;
  const trimmedCustom = customText.trim();
  const canSubmit =
    selection === CUSTOM_SENTINEL
       ? trimmedCustom.length > 0
      : selection.length > 0;

  const handleSubmit = () => {
    if (!canSubmit || disabled) return;
    if (selection === CUSTOM_SENTINEL) {
      onSubmit({
        question_id: question.id,
        question_text: question.question,
        custom_answer: trimmedCustom,
      });
    } else {
      onSubmit({
        question_id: question.id,
        question_text: question.question,
        selected_option: selection,
      });
    }
    setSelection("");
    setCustomText("");
  };

  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-800 dark:text-amber-100">
          Plan clarifier
        </span>
        {plan.answers && plan.answers.length > 0 ? (
          <span className="text-xs text-amber-700 dark:text-amber-300">
            {plan.answers.length} answered
          </span>
        ) : null}
      </div>

      <div className="mb-3 text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {question.question}
      </div>

      <div className="space-y-1.5">
        {question.options.map((option, idx) => {
          const optionId = `plan-q-${question.id}-opt-${idx}`;
          return (
            <label
              key={optionId}
              htmlFor={optionId}
              className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-sm text-neutral-800 hover:bg-amber-100/60 dark:text-neutral-200 dark:hover:bg-amber-900/30"
            >
              <input
                id={optionId}
                type="radio"
                name={`plan-q-${question.id}`}
                value={option}
                checked={selection === option}
                onChange={() => setSelection(option)}
                disabled={disabled}
                className="mt-0.5"
              />
              <span>{option}</span>
            </label>
          );
        })}

        {allowCustom ? (
          <div>
            <label
              htmlFor={`plan-q-${question.id}-custom`}
              className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-sm text-neutral-800 hover:bg-amber-100/60 dark:text-neutral-200 dark:hover:bg-amber-900/30"
            >
              <input
                id={`plan-q-${question.id}-custom`}
                type="radio"
                name={`plan-q-${question.id}`}
                value={CUSTOM_SENTINEL}
                checked={selection === CUSTOM_SENTINEL}
                onChange={() => setSelection(CUSTOM_SENTINEL)}
                disabled={disabled}
                className="mt-0.5"
              />
              <span>Other...</span>
            </label>
            {selection === CUSTOM_SENTINEL ? (
              <textarea
                value={customText}
                onChange={(event) => setCustomText(event.target.value)}
                disabled={disabled}
                rows={2}
                placeholder="Type your answer..."
                className="mt-1.5 w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-amber-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-amber-200 pt-2 dark:border-amber-900">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || disabled}
          className="inline-flex items-center rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-amber-500 dark:hover:bg-amber-600"
        >
          Submit answer
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={disabled}
          className="inline-flex items-center rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
        >
          Cancel plan
        </button>
      </div>
    </div>
  );
};
