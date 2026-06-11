import { useEffect, useMemo, useState } from "react";
import type { FC } from "react";
import type {
  AgentPlanProposal,
  AgentPlanProposalAnswer,
  AgentPlanProposalQuestion,
} from "@/services/roadmap-agent.service";

export interface RoadmapAiPlanQuestionCardProps {
  plan: AgentPlanProposal;
  /** Called with the full batch of answers when the user finishes the last question. */
  onSubmit: (answers: AgentPlanProposalAnswer[]) => void;
  onDiscard: () => void;
  disabled?: boolean;
}

const CUSTOM_SENTINEL = "__custom__";

const resolveQuestions = (plan: AgentPlanProposal): AgentPlanProposalQuestion[] => {
  if (Array.isArray(plan.current_questions) && plan.current_questions.length > 0) {
    return plan.current_questions;
  }
  if (plan.current_question) return [plan.current_question];
  return [];
};

export const RoadmapAiPlanQuestionCard: FC<RoadmapAiPlanQuestionCardProps> = ({
  plan,
  onSubmit,
  onDiscard,
  disabled,
}) => {
  const questions = useMemo(() => resolveQuestions(plan), [plan]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [customs, setCustoms] = useState<Record<string, string>>({});

  // Reset pagination + drafts when the plan switches to a new batch of
  // questions (e.g. the model asked another round after the first answers).
  useEffect(() => {
    setCurrentIndex(0);
    setSelections({});
    setCustoms({});
  }, [plan.plan_id, questions.length]);

  if (questions.length === 0) return null;

  const boundedIndex = Math.min(currentIndex, questions.length - 1);
  const currentQ = questions[boundedIndex];
  const totalQuestions = questions.length;
  const hasMultiple = totalQuestions > 1;
  const isLast = boundedIndex === totalQuestions - 1;

  const selection = selections[currentQ.id] ?? "";
  const customText = customs[currentQ.id] ?? "";
  const allowCustom = currentQ.allow_custom !== false;
  const trimmedCustom = customText.trim();
  const currentAnswered =
    selection === CUSTOM_SENTINEL
      ? trimmedCustom.length > 0
      : selection.length > 0;

  const allAnswered = questions.every((q) => {
    const sel = selections[q.id] ?? "";
    if (sel === CUSTOM_SENTINEL) {
      return (customs[q.id] ?? "").trim().length > 0;
    }
    return sel.length > 0;
  });

  const buildAnswers = (): AgentPlanProposalAnswer[] =>
    questions.map((q) => {
      const sel = selections[q.id] ?? "";
      if (sel === CUSTOM_SENTINEL) {
        return {
          question_id: q.id,
          question_text: q.question,
          custom_answer: (customs[q.id] ?? "").trim(),
        };
      }
      return {
        question_id: q.id,
        question_text: q.question,
        selected_option: sel,
      };
    });

  const handleNext = () => {
    if (!currentAnswered || disabled) return;
    if (isLast) return;
    setCurrentIndex(boundedIndex + 1);
  };

  const handleBack = () => {
    if (boundedIndex === 0 || disabled) return;
    setCurrentIndex(boundedIndex - 1);
  };

  const handleSubmit = () => {
    if (!allAnswered || disabled) return;
    onSubmit(buildAnswers());
    setSelections({});
    setCustoms({});
    setCurrentIndex(0);
  };

  const setCurrentSelection = (value: string) => {
    setSelections((prev) => ({ ...prev, [currentQ.id]: value }));
  };
  const setCurrentCustom = (value: string) => {
    setCustoms((prev) => ({ ...prev, [currentQ.id]: value }));
  };

  return (
    <div className="mt-2 gemini-gradient-soft rounded-lg border border-purple-200 p-3 dark:border-purple-900 dark:bg-purple-950/30">
      <div className="mb-2 flex items-center gap-2">
        <span className="gemini-gradient-bg inline-flex rounded-full px-2 py-0.5 text-xs font-semibold text-white">
          Plan clarifier
        </span>
        {hasMultiple ? (
          <span className="text-xs font-medium text-purple-800 dark:text-purple-300">
            Question {boundedIndex + 1} of {totalQuestions}
          </span>
        ) : null}
        {plan.answers && plan.answers.length > 0 ? (
          <span className="text-xs text-purple-700 dark:text-purple-300">
            ({plan.answers.length} answered so far)
          </span>
        ) : null}
      </div>

      <div className="mb-3 text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {currentQ.question}
      </div>

      <div className="space-y-1.5">
        {currentQ.options.map((option, idx) => {
          const optionId = `plan-q-${currentQ.id}-opt-${idx}`;
          return (
            <label
              key={optionId}
              htmlFor={optionId}
              className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-sm text-neutral-800 hover:bg-purple-100/50 dark:text-neutral-200 dark:hover:bg-purple-900/30"
            >
              <input
                id={optionId}
                type="radio"
                name={`plan-q-${currentQ.id}`}
                value={option}
                checked={selection === option}
                onChange={() => setCurrentSelection(option)}
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
              htmlFor={`plan-q-${currentQ.id}-custom`}
              className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-sm text-neutral-800 hover:bg-purple-100/50 dark:text-neutral-200 dark:hover:bg-purple-900/30"
            >
              <input
                id={`plan-q-${currentQ.id}-custom`}
                type="radio"
                name={`plan-q-${currentQ.id}`}
                value={CUSTOM_SENTINEL}
                checked={selection === CUSTOM_SENTINEL}
                onChange={() => setCurrentSelection(CUSTOM_SENTINEL)}
                disabled={disabled}
                className="mt-0.5"
              />
              <span>Other...</span>
            </label>
            {selection === CUSTOM_SENTINEL ? (
              <textarea
                value={customText}
                onChange={(event) => setCurrentCustom(event.target.value)}
                disabled={disabled}
                rows={2}
                placeholder="Type your answer..."
                className="mt-1.5 w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-purple-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-purple-200 pt-2 dark:border-purple-900">
        {hasMultiple && boundedIndex > 0 ? (
          <button
            type="button"
            onClick={handleBack}
            disabled={disabled}
            className="inline-flex items-center rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            Back
          </button>
        ) : null}
        {!isLast ? (
          <button
            type="button"
            onClick={handleNext}
            disabled={!currentAnswered || disabled}
            className="gemini-gradient-bg inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!allAnswered || disabled}
            className="gemini-gradient-bg inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {hasMultiple ? "Submit answers" : "Submit answer"}
          </button>
        )}
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
