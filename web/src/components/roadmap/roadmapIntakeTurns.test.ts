import { describe, expect, it } from "vitest";
import {
	buildTurnFromAnswers,
	describeCaptured,
	INTAKE_SLOT_CHIPS,
	isSlotFilled,
} from "./roadmapIntakeTurns";

describe("isSlotFilled", () => {
	it("treats blank and whitespace-only strings as empty", () => {
		expect(isSlotFilled({ product: "app" }, "product")).toBe(true);
		expect(isSlotFilled({ product: "   " }, "product")).toBe(false);
		expect(isSlotFilled({}, "product")).toBe(false);
	});

	it("treats an empty feature list as empty", () => {
		expect(isSlotFilled({ features: [] }, "features")).toBe(false);
		expect(isSlotFilled({ features: ["Reminders"] }, "features")).toBe(true);
	});

	it("covers every slot the progress strip renders", () => {
		const captured = {
			product: "a",
			audience: "b",
			features: ["c"],
			platform: "d",
			constraints: "e",
		};
		for (const chip of INTAKE_SLOT_CHIPS) {
			expect(isSlotFilled(captured, chip.key)).toBe(true);
		}
	});
});

describe("buildTurnFromAnswers", () => {
	it("keeps each question next to its answer", () => {
		const turn = buildTurnFromAnswers([
			{
				question_id: "audience",
				question: "Who are the primary users?",
				selected_options: ["Adults 65+"],
			},
			{
				question_id: "features",
				question: "Which capabilities?",
				selected_options: ["Workout plans", "Reminders"],
			},
		]);

		expect(turn).toBe(
			"Who are the primary users? -> Adults 65+\nWhich capabilities? -> Workout plans, Reminders",
		);
	});

	it("appends a custom answer alongside the selected options", () => {
		const turn = buildTurnFromAnswers([
			{
				question_id: "audience",
				question: "Who for?",
				selected_options: ["Adults 65+"],
				custom_answer: "and their carers",
			},
		]);

		expect(turn).toBe("Who for? -> Adults 65+, and their carers");
	});

	it("falls back to the question id when no question text came back", () => {
		const turn = buildTurnFromAnswers([
			{ question_id: "platform", selected_options: ["Mobile"] },
		]);

		expect(turn).toBe("platform -> Mobile");
	});

	it("drops answers with nothing selected", () => {
		const turn = buildTurnFromAnswers([
			{ question_id: "audience", question: "Who for?", selected_options: [] },
			{
				question_id: "platform",
				question: "Where?",
				selected_options: ["Mobile"],
			},
		]);

		expect(turn).toBe("Where? -> Mobile");
	});
});

describe("describeCaptured", () => {
	it("summarises only the slots that are filled", () => {
		expect(
			describeCaptured({ product: "fitness app", features: ["Reminders"] }),
		).toBe("Building: fitness app · v1: Reminders");
		expect(describeCaptured({})).toBe("");
	});
});
