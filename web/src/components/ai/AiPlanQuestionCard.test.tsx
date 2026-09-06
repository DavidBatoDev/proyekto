/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentPlanProposal } from "@/services/ai-agent.service";
import { AiPlanQuestionCard } from "./AiPlanQuestionCard";

afterEach(cleanup);

describe("AiPlanQuestionCard entity-link fallback", () => {
	it.each(["current_questions", "current_question"] as const)(
		"renders and submits plain text for %s while preserving the question id",
		(field) => {
			const question = {
				id: "target",
				question: "Add to [Roadmap](proyekto://roadmap/R2)?",
				options: ["Under [Epic](proyekto://epic/E1)"],
				allow_custom: false,
			};
			const plan: AgentPlanProposal = {
				plan_id: "p1",
				summary: "Choose a parent",
				goal: "Plan work",
				proposed_hierarchy: [],
				[field]: field === "current_questions" ? [question] : question,
			};
			const onSubmit = vi.fn();
			const { container } = render(
				<AiPlanQuestionCard
					plan={plan}
					onSubmit={onSubmit}
					onDiscard={vi.fn()}
				/>,
			);
			expect(screen.getByText("Add to Roadmap?")).toBeTruthy();
			expect(container.innerHTML).not.toContain("proyekto:");
			expect(container.querySelector("a")).toBeNull();
			fireEvent.click(screen.getByRole("radio", { name: "Under Epic" }));
			fireEvent.click(screen.getByRole("button", { name: "Submit answer" }));
			expect(onSubmit).toHaveBeenCalledWith([
				{
					question_id: "target",
					question_text: "Add to Roadmap?",
					selected_option: "Under Epic",
				},
			]);
		},
	);
});
