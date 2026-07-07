import type { FC } from "react";
import { useEffect, useMemo, useState } from "react";
import type {
	AgentClarifierAnswerEntry,
	AgentClarifierCard,
} from "@/services/roadmap-agent.service";
import {
	buildClarifierAnswers,
	CUSTOM_SENTINEL,
	isClarifierQuestionAnswered,
	resolveClarifierQuestions,
} from "./RoadmapAiClarifierCard.logic";

export interface RoadmapAiClarifierCardProps {
	card: AgentClarifierCard;
	onSubmit: (answers: AgentClarifierAnswerEntry[]) => void;
	disabled?: boolean;
}

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
	const questions = useMemo(() => resolveClarifierQuestions(card), [card]);
	const [currentIndex, setCurrentIndex] = useState<number>(0);
	const [selections, setSelections] = useState<Record<string, string[]>>({});
	const [customs, setCustoms] = useState<Record<string, string>>({});

	// Reset pagination + drafts when a new card replaces this one (e.g. the
	// agent asked a follow-up clarifier after the first answers).
	useEffect(() => {
		setCurrentIndex(0);
		setSelections({});
		setCustoms({});
	}, [card.question_id]);

	if (questions.length === 0) return null;

	const boundedIndex = Math.min(currentIndex, questions.length - 1);
	const currentQ = questions[boundedIndex];
	const totalQuestions = questions.length;
	const hasMultiple = totalQuestions > 1;
	const isLast = boundedIndex === totalQuestions - 1;

	const selected = selections[currentQ.id] ?? [];
	const customText = customs[currentQ.id] ?? "";
	const allowCustom = currentQ.allow_custom !== false;
	const customSelected = selected.includes(CUSTOM_SENTINEL);

	const currentAnswered = isClarifierQuestionAnswered(
		currentQ,
		selections,
		customs,
	);
	const allAnswered = questions.every((q) =>
		isClarifierQuestionAnswered(q, selections, customs),
	);

	const setValue = (value: string) => {
		setSelections((prev) => {
			const existing = prev[currentQ.id] ?? [];
			if (currentQ.multi_select) {
				const next = existing.includes(value)
					? existing.filter((v) => v !== value)
					: [...existing, value];
				return { ...prev, [currentQ.id]: next };
			}
			return { ...prev, [currentQ.id]: [value] };
		});
	};

	const setCurrentCustom = (value: string) => {
		setCustoms((prev) => ({ ...prev, [currentQ.id]: value }));
	};

	const handleNext = () => {
		if (!currentAnswered || disabled || isLast) return;
		setCurrentIndex(boundedIndex + 1);
	};

	const handleBack = () => {
		if (boundedIndex === 0 || disabled) return;
		setCurrentIndex(boundedIndex - 1);
	};

	const handleSubmit = () => {
		if (!allAnswered || disabled) return;
		onSubmit(buildClarifierAnswers(questions, selections, customs));
		setSelections({});
		setCustoms({});
		setCurrentIndex(0);
	};

	const inputType = currentQ.multi_select ? "checkbox" : "radio";
	const groupName = `clarifier-${card.question_id}-${currentQ.id}`;

	return (
		<div
			data-testid="clarifier-card"
			className="ai-gradient-soft mt-2 rounded-lg border border-indigo-200 p-3 dark:border-indigo-900 dark:bg-indigo-950/30"
		>
			<div className="mb-2 flex items-center gap-2">
				<span className="ai-gradient-bg inline-flex rounded-full px-2 py-0.5 text-xs font-semibold text-white">
					{laneLabel(card.lane)}
				</span>
				{currentQ.header ? (
					<span className="inline-flex rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200">
						{currentQ.header}
					</span>
				) : null}
				{hasMultiple ? (
					<span className="text-xs font-medium text-indigo-800 dark:text-indigo-300">
						Question {boundedIndex + 1} of {totalQuestions}
					</span>
				) : null}
			</div>

			<div
				data-testid="clarifier-question"
				data-question-id={currentQ.id}
				data-multi-select={currentQ.multi_select}
			>
				<div className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">
					{currentQ.question}
				</div>
				{currentQ.multi_select ? (
					<div className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
						Select all that apply
					</div>
				) : (
					<div className="mb-2" />
				)}

				<div className="space-y-1.5">
					{currentQ.options.map((option, idx) => {
						const optionId = `clarifier-${currentQ.id}-opt-${idx}`;
						return (
							<label
								key={optionId}
								htmlFor={optionId}
								data-testid="clarifier-option"
								data-option-label={option.label}
								className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-sm text-neutral-800 hover:bg-indigo-100/50 dark:text-neutral-200 dark:hover:bg-indigo-900/30"
							>
								<input
									id={optionId}
									type={inputType}
									name={groupName}
									value={option.label}
									checked={selected.includes(option.label)}
									onChange={() => setValue(option.label)}
									disabled={disabled}
									className="mt-0.5"
								/>
								<span>
									{option.label}
									{option.description ? (
										<span className="block text-xs text-neutral-500 dark:text-neutral-400">
											{option.description}
										</span>
									) : null}
								</span>
							</label>
						);
					})}

					{allowCustom ? (
						<div>
							<label
								htmlFor={`clarifier-${currentQ.id}-custom`}
								data-testid="clarifier-other"
								className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-sm text-neutral-800 hover:bg-indigo-100/50 dark:text-neutral-200 dark:hover:bg-indigo-900/30"
							>
								<input
									id={`clarifier-${currentQ.id}-custom`}
									type={inputType}
									name={groupName}
									value={CUSTOM_SENTINEL}
									checked={customSelected}
									onChange={() => setValue(CUSTOM_SENTINEL)}
									disabled={disabled}
									className="mt-0.5"
								/>
								<span>Other...</span>
							</label>
							{customSelected ? (
								<textarea
									data-testid="clarifier-other-input"
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
			</div>

			<div className="mt-3 flex items-center gap-2 border-t border-indigo-200 pt-2 dark:border-indigo-900">
				{hasMultiple && boundedIndex > 0 ? (
					<button
						type="button"
						data-testid="clarifier-back"
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
						data-testid="clarifier-next"
						onClick={handleNext}
						disabled={!currentAnswered || disabled}
						className="ai-gradient-bg inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
					>
						Next
					</button>
				) : (
					<button
						type="button"
						data-testid="clarifier-submit"
						onClick={handleSubmit}
						disabled={!allAnswered || disabled}
						className="ai-gradient-bg inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
					>
						{hasMultiple ? "Submit answers" : "Submit answer"}
					</button>
				)}
			</div>
		</div>
	);
};
