import { useState } from "react";
import type { FC } from "react";
import type { AgentClarifierCard } from "@/services/roadmap-agent.service";

export interface ClarifierAnswer {
  question_id: string;
  selected_option?: string;
  custom_answer?: string;
}

export interface RoadmapAiClarifierCardProps {
  card: AgentClarifierCard;
  onSubmit: (answer: ClarifierAnswer) => void;
  disabled?: boolean;
}

const CUSTOM_SENTINEL = "__custom__";

const laneLabel = (lane: AgentClarifierCard["lane"]): string => {
  if (lane === "plan") return "Plan clarifier";
  if (lane === "query") return "Resolve reference";
  return "Edit clarifier";
};

export const RoadmapAiClarifierCard: FC<RoadmapAiClarifierCardProps> = ({
  card,
  onSubmit,
  disabled,
}) => {
  const [selection, setSelection] = useState<string>("");
  const [customText, setCustomText] = useState<string>("");

  const allowCustom = card.allow_custom !== false;
  const trimmedCustom = customText.trim();
  const canSubmit =
    selection === CUSTOM_SENTINEL
      ? trimmedCustom.length > 0
      : selection.length > 0;

  const handleSubmit = () => {
    if (!canSubmit || disabled) return;
    const payload: ClarifierAnswer =
      selection === CUSTOM_SENTINEL
        ? { question_id: card.question_id, custom_answer: trimmedCustom }
        : { question_id: card.question_id, selected_option: selection };
    onSubmit(payload);
    setSelection("");
    setCustomText("");
  };

  return (
    <div className="gemini-gradient-soft mt-2 rounded-lg border border-purple-200 p-3 dark:border-purple-900 dark:bg-purple-950/30">
      <div className="mb-2 flex items-center gap-2">
        <span className="gemini-gradient-bg inline-flex rounded-full px-2 py-0.5 text-xs font-semibold text-white">
          {laneLabel(card.lane)}
        </span>
      </div>

      <div className="mb-3 text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {card.question}
      </div>

      <div className="space-y-1.5">
        {card.options.map((option, idx) => {
          const optionId = `clarifier-${card.question_id}-opt-${idx}`;
          return (
            <label
              key={optionId}
              htmlFor={optionId}
              className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-sm text-neutral-800 hover:bg-purple-100/50 dark:text-neutral-200 dark:hover:bg-purple-900/30"
            >
              <input
                id={optionId}
                type="radio"
                name={`clarifier-${card.question_id}`}
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
              htmlFor={`clarifier-${card.question_id}-custom`}
              className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-sm text-neutral-800 hover:bg-purple-100/50 dark:text-neutral-200 dark:hover:bg-purple-900/30"
            >
              <input
                id={`clarifier-${card.question_id}-custom`}
                type="radio"
                name={`clarifier-${card.question_id}`}
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
                className="mt-1.5 w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-purple-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-purple-200 pt-2 dark:border-purple-900">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || disabled}
          className="gemini-gradient-bg inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Submit answer
        </button>
      </div>
    </div>
  );
};
