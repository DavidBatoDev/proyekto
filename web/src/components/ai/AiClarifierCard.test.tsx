/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiClarifierCard } from "./AiClarifierCard";
import type { ClarifierCardLike } from "./AiClarifierCard.logic";

afterEach(cleanup);

/**
 * The shape the intake model actually produced in the reported bug: its own
 * "Other" option carrying a "please specify" description, and `allow_custom`
 * turned off — which together left the question unanswerable.
 */
const cardWithModelCatchAll: ClarifierCardLike = {
	question_id: "intake-1",
	questions: [
		{
			id: "product",
			header: "Product and Audience",
			question: "What product are you looking to build and who is it for?",
			multi_select: false,
			allow_custom: false,
			options: [
				{ label: "Fitness app", description: "Fitness tracking and guidance." },
				{
					label: "Educational tool",
					description: "For learning and teaching.",
				},
				{ label: "Other", description: "Please specify your product." },
			],
		},
	],
};

const platformQuestion = {
	id: "platform",
	header: "Platform",
	question: "Where should it run?",
	multi_select: false,
	allow_custom: true,
	options: [{ label: "Web" }, { label: "Mobile" }],
};

const cardWithoutCatchAll: ClarifierCardLike = {
	question_id: "intake-2",
	questions: [platformQuestion],
};

describe("AiClarifierCard — model-supplied catch-all", () => {
	it("reveals a text input when the model's Other option is chosen", () => {
		render(<AiClarifierCard card={cardWithModelCatchAll} onSubmit={vi.fn()} />);

		expect(screen.queryByTestId("clarifier-other-input")).toBeNull();

		fireEvent.click(screen.getByLabelText(/Other/));

		expect(screen.getByTestId("clarifier-other-input")).toBeTruthy();
	});

	it("renders exactly one catch-all row, not the model's plus the built-in one", () => {
		render(<AiClarifierCard card={cardWithModelCatchAll} onSubmit={vi.fn()} />);

		expect(screen.getAllByTestId("clarifier-other")).toHaveLength(1);
		// The two concrete options stay ordinary radios.
		expect(screen.getAllByTestId("clarifier-option")).toHaveLength(2);
	});

	it("keeps the model's description instead of a bare 'Other...'", () => {
		render(<AiClarifierCard card={cardWithModelCatchAll} onSubmit={vi.fn()} />);

		expect(screen.getByText("Please specify your product.")).toBeTruthy();
	});

	it("submits the typed text rather than the literal word 'Other'", () => {
		const onSubmit = vi.fn();
		render(
			<AiClarifierCard card={cardWithModelCatchAll} onSubmit={onSubmit} />,
		);

		fireEvent.click(screen.getByLabelText(/Other/));
		fireEvent.change(screen.getByTestId("clarifier-other-input"), {
			target: { value: "A B2B invoicing tool for freelancers" },
		});
		fireEvent.click(screen.getByTestId("clarifier-submit"));

		expect(onSubmit).toHaveBeenCalledWith([
			{
				question_id: "product",
				question: cardWithModelCatchAll.questions?.[0].question,
				selected_options: [],
				custom_answer: "A B2B invoicing tool for freelancers",
			},
		]);
	});

	it("blocks submit while the catch-all is selected but empty", () => {
		const onSubmit = vi.fn();
		render(
			<AiClarifierCard card={cardWithModelCatchAll} onSubmit={onSubmit} />,
		);

		fireEvent.click(screen.getByLabelText(/Other/));
		fireEvent.click(screen.getByTestId("clarifier-submit"));

		expect(onSubmit).not.toHaveBeenCalled();
	});
});

describe("AiClarifierCard — built-in catch-all", () => {
	it("still renders its own Other row when the model supplies none", () => {
		render(<AiClarifierCard card={cardWithoutCatchAll} onSubmit={vi.fn()} />);

		const other = screen.getByTestId("clarifier-other");
		expect(other.textContent).toContain("Other");
		expect(screen.getAllByTestId("clarifier-option")).toHaveLength(2);

		fireEvent.click(screen.getByLabelText(/Other/));
		expect(screen.getByTestId("clarifier-other-input")).toBeTruthy();
	});

	it("omits the row entirely when the model disallows custom answers", () => {
		render(
			<AiClarifierCard
				card={{
					...cardWithoutCatchAll,
					questions: [{ ...platformQuestion, allow_custom: false }],
				}}
				onSubmit={vi.fn()}
			/>,
		);

		expect(screen.queryByTestId("clarifier-other")).toBeNull();
	});
});
