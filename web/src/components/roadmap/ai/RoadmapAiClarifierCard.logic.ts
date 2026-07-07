import type {
	AgentClarifierAnswerEntry,
	AgentClarifierCard,
	AgentClarifierQuestion,
} from "@/services/roadmap-agent.service";

export const CUSTOM_SENTINEL = "__custom__";

const MAX_DISPLAY_LABEL_CHARS = 140;

/**
 * Prefer the structured `questions` array; synthesize a single radio question
 * from the legacy flat fields otherwise (cards from older agents, old
 * persisted `metadata.clarifier` rows, budget cards).
 */
export const resolveClarifierQuestions = (
	card: AgentClarifierCard,
): AgentClarifierQuestion[] => {
	if (Array.isArray(card.questions) && card.questions.length > 0) {
		return card.questions.filter((q) => (q.question ?? "").trim().length > 0);
	}
	const question = (card.question ?? "").trim();
	const options = (card.options ?? []).filter(
		(label) => typeof label === "string" && label.trim().length > 0,
	);
	if (!question && options.length === 0) return [];
	return [
		{
			id: card.question_id,
			header: null,
			question,
			multi_select: false,
			// A 0-option question is unanswerable without the free-form input.
			allow_custom: card.allow_custom !== false || options.length === 0,
			options: options.map((label) => ({ label })),
		},
	];
};

export const isClarifierQuestionAnswered = (
	question: AgentClarifierQuestion,
	selections: Record<string, string[]>,
	customs: Record<string, string>,
): boolean => {
	const selected = selections[question.id] ?? [];
	const customText = (customs[question.id] ?? "").trim();
	const hasCustomSelected = selected.includes(CUSTOM_SENTINEL);
	if (hasCustomSelected && customText.length === 0) return false;
	return selected.length > 0;
};

export const buildClarifierAnswers = (
	questions: AgentClarifierQuestion[],
	selections: Record<string, string[]>,
	customs: Record<string, string>,
): AgentClarifierAnswerEntry[] =>
	questions.map((question) => {
		const selected = selections[question.id] ?? [];
		const optionOrder = question.options.map((o) => o.label);
		const selectedOptions = selected
			.filter((value) => value !== CUSTOM_SENTINEL)
			.sort((a, b) => optionOrder.indexOf(a) - optionOrder.indexOf(b));
		const entry: AgentClarifierAnswerEntry = {
			question_id: question.id,
			question: question.question,
			selected_options: selectedOptions,
		};
		if (selected.includes(CUSTOM_SENTINEL)) {
			const customText = (customs[question.id] ?? "").trim();
			if (customText) entry.custom_answer = customText;
		}
		return entry;
	});

const answerValues = (answer: AgentClarifierAnswerEntry): string[] => {
	const values = [...answer.selected_options];
	if (answer.custom_answer) values.push(answer.custom_answer);
	return values;
};

/** Friendly chat-bubble label shown instead of the raw sentinel JSON. */
export const buildClarifierDisplayLabel = (
	answers: AgentClarifierAnswerEntry[],
): string => {
	const parts = answers
		.map((answer) => answerValues(answer).join(", "))
		.filter((part) => part.length > 0);
	const label = answers.length === 1 ? (parts[0] ?? "") : parts.join(" · ");
	if (!label) return "Submitted answer.";
	return label.length > MAX_DISPLAY_LABEL_CHARS
		? `${label.slice(0, MAX_DISPLAY_LABEL_CHARS - 1)}…`
		: label;
};

/**
 * Wire payload for the `__clarifier_answer__` sentinel. Single-question cards
 * also carry the legacy top-level keys so an older agent (which only ever
 * emits single-question cards) still folds the answer sensibly.
 */
export const buildClarifierSentinelPayload = (
	lane: AgentClarifierCard["lane"],
	card: AgentClarifierCard,
	answers: AgentClarifierAnswerEntry[],
): Record<string, unknown> => {
	const payload: Record<string, unknown> = {
		lane,
		question_id: card.question_id,
		answers,
	};
	if (answers.length === 1) {
		const only = answers[0];
		if (only.selected_options.length > 0) {
			payload.selected_option = only.selected_options.join(", ");
		}
		if (only.custom_answer) {
			payload.custom_answer = only.custom_answer;
		}
	}
	return payload;
};
