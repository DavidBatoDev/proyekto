import { describe, expect, it } from "vitest";
import type {
	AgentClarifierCard,
	AgentClarifierQuestion,
} from "@/services/roadmap-agent.service";
import {
	buildClarifierAnswers,
	buildClarifierDisplayLabel,
	buildClarifierSentinelPayload,
	CUSTOM_SENTINEL,
	isClarifierQuestionAnswered,
	resolveClarifierQuestions,
} from "./RoadmapAiClarifierCard.logic";

// Exactly the card shape older agents emit (and old persisted
// metadata.clarifier rows contain) — no `questions` key.
const legacyCard: AgentClarifierCard = {
	lane: "edit",
	question_id: "card-1",
	question: "Which epic?",
	options: ["Growth", "Retention"],
	allow_custom: true,
	reason: "agent_clarifier",
};

const radioQuestion: AgentClarifierQuestion = {
	id: "q1",
	header: "Target epic",
	question: "Which epic?",
	multi_select: false,
	allow_custom: true,
	options: [
		{ label: "Growth", description: "has 3 features" },
		{ label: "Retention" },
	],
};

const multiQuestion: AgentClarifierQuestion = {
	id: "q2",
	header: null,
	question: "Which fields?",
	multi_select: true,
	allow_custom: true,
	options: [{ label: "Status" }, { label: "Assignee" }, { label: "Due date" }],
};

const richCard: AgentClarifierCard = {
	...legacyCard,
	questions: [radioQuestion, multiQuestion],
};

describe("resolveClarifierQuestions", () => {
	it("synthesizes a single radio question from a legacy card", () => {
		const questions = resolveClarifierQuestions(legacyCard);
		expect(questions).toHaveLength(1);
		expect(questions[0].id).toBe("card-1");
		expect(questions[0].multi_select).toBe(false);
		expect(questions[0].options.map((o) => o.label)).toEqual([
			"Growth",
			"Retention",
		]);
	});

	it("prefers the structured questions array when present", () => {
		const questions = resolveClarifierQuestions(richCard);
		expect(questions).toHaveLength(2);
		expect(questions[1].multi_select).toBe(true);
	});

	it("keeps a 0-option budget card answerable via Other", () => {
		const budgetCard: AgentClarifierCard = {
			...legacyCard,
			question: "Could you rephrase or narrow the request?",
			options: [],
			allow_custom: false, // even a bad payload must stay answerable
			reason: "budget_exhausted",
		};
		const questions = resolveClarifierQuestions(budgetCard);
		expect(questions).toHaveLength(1);
		expect(questions[0].allow_custom).toBe(true);
		expect(questions[0].options).toEqual([]);
	});

	it("returns empty for a card with no question and no options", () => {
		expect(
			resolveClarifierQuestions({ ...legacyCard, question: "", options: [] }),
		).toEqual([]);
	});
});

describe("isClarifierQuestionAnswered", () => {
	it("radio: one pick answers, nothing picked does not", () => {
		expect(isClarifierQuestionAnswered(radioQuestion, {}, {})).toBe(false);
		expect(
			isClarifierQuestionAnswered(radioQuestion, { q1: ["Growth"] }, {}),
		).toBe(true);
	});

	it("Other selected with empty text blocks; non-empty text answers", () => {
		expect(
			isClarifierQuestionAnswered(
				radioQuestion,
				{ q1: [CUSTOM_SENTINEL] },
				{ q1: "   " },
			),
		).toBe(false);
		expect(
			isClarifierQuestionAnswered(
				radioQuestion,
				{ q1: [CUSTOM_SENTINEL] },
				{ q1: "Something else" },
			),
		).toBe(true);
	});

	it("multi-select: needs at least one; Other-checked needs text too", () => {
		expect(isClarifierQuestionAnswered(multiQuestion, { q2: [] }, {})).toBe(
			false,
		);
		expect(
			isClarifierQuestionAnswered(multiQuestion, { q2: ["Status"] }, {}),
		).toBe(true);
		expect(
			isClarifierQuestionAnswered(
				multiQuestion,
				{ q2: ["Status", CUSTOM_SENTINEL] },
				{ q2: "" },
			),
		).toBe(false);
		expect(
			isClarifierQuestionAnswered(
				multiQuestion,
				{ q2: ["Status", CUSTOM_SENTINEL] },
				{ q2: "owner" },
			),
		).toBe(true);
	});
});

describe("buildClarifierAnswers", () => {
	it("orders multi-select values by option order and trims custom", () => {
		const answers = buildClarifierAnswers(
			[radioQuestion, multiQuestion],
			{ q1: ["Growth"], q2: [CUSTOM_SENTINEL, "Assignee", "Status"] },
			{ q2: "  the owner  " },
		);
		expect(answers).toEqual([
			{
				question_id: "q1",
				question: "Which epic?",
				selected_options: ["Growth"],
			},
			{
				question_id: "q2",
				question: "Which fields?",
				selected_options: ["Status", "Assignee"],
				custom_answer: "the owner",
			},
		]);
	});

	it("omits custom_answer when Other is not selected", () => {
		const answers = buildClarifierAnswers(
			[radioQuestion],
			{ q1: ["Retention"] },
			{ q1: "stale draft text" },
		);
		expect(answers[0].custom_answer).toBeUndefined();
	});
});

describe("buildClarifierDisplayLabel", () => {
	it("single answer shows the bare value(s)", () => {
		expect(
			buildClarifierDisplayLabel([
				{ question_id: "q1", selected_options: ["Growth"] },
			]),
		).toBe("Growth");
	});

	it("multiple answers join with a separator and truncate", () => {
		const label = buildClarifierDisplayLabel([
			{ question_id: "q1", selected_options: ["Growth"] },
			{
				question_id: "q2",
				selected_options: ["Status"],
				custom_answer: "x".repeat(200),
			},
		]);
		expect(label.startsWith("Growth · Status, x")).toBe(true);
		expect(label.length).toBeLessThanOrEqual(140);
		expect(label.endsWith("…")).toBe(true);
	});

	it("falls back to a generic label when nothing was selected", () => {
		expect(
			buildClarifierDisplayLabel([{ question_id: "q1", selected_options: [] }]),
		).toBe("Submitted answer.");
	});
});

describe("buildClarifierSentinelPayload", () => {
	it("mirrors legacy keys only for single-question answers", () => {
		const single = buildClarifierSentinelPayload("edit", legacyCard, [
			{ question_id: "card-1", selected_options: ["Growth"] },
		]);
		expect(single.selected_option).toBe("Growth");
		expect(single.answers).toHaveLength(1);

		const multi = buildClarifierSentinelPayload("edit", richCard, [
			{ question_id: "q1", selected_options: ["Growth"] },
			{ question_id: "q2", selected_options: ["Status"] },
		]);
		expect(multi.selected_option).toBeUndefined();
		expect(multi.answers).toHaveLength(2);
	});

	it("mirrors custom_answer for a single Other answer", () => {
		const payload = buildClarifierSentinelPayload("edit", legacyCard, [
			{
				question_id: "card-1",
				selected_options: [],
				custom_answer: "the second one",
			},
		]);
		expect(payload.custom_answer).toBe("the second one");
		expect(payload.selected_option).toBeUndefined();
	});
});
