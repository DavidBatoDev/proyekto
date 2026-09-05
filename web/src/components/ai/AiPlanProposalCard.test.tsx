/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentPlanProposal } from "@/services/ai-agent.service";
import { AiPlanProposalCard } from "./AiPlanProposalCard";

afterEach(cleanup);

const epic = { title: "Onboarding", features: [] };

const legacyPlan: AgentPlanProposal = {
	plan_id: "plan-legacy",
	summary: "Add onboarding",
	goal: "Improve activation",
	proposed_hierarchy: [epic],
	status: "proposed",
};

const twoRoadmapEdits: AgentPlanProposal = {
	plan_id: "plan-edits",
	kind: "edits",
	run_id: "run-1",
	summary: "Add an epic to two roadmaps",
	goal: "In A and B add an epic called PW-Dash",
	proposed_hierarchy: [epic],
	status: "proposed",
	targets: [
		{
			roadmap_id: "rm-a",
			roadmap_title: "Roadmap A",
			project_id: "p-a",
			operations_count: 1,
			contains_delete: false,
			summary_lines: ['Add epic "PW-Dash"'],
			proposed_hierarchy: [epic],
		},
		{
			roadmap_id: "rm-b",
			roadmap_title: "Roadmap B",
			project_id: "p-b",
			operations_count: 3,
			contains_delete: true,
			summary_lines: ['Add epic "PW-Dash"', 'Delete epic "Old" and 1 more'],
			proposed_hierarchy: [epic],
		},
	],
};

describe("AiPlanProposalCard targets", () => {
	it("lists every target roadmap with counts, delete badge and summary lines", () => {
		render(
			<AiPlanProposalCard
				plan={twoRoadmapEdits}
				onApply={vi.fn()}
				onDiscard={vi.fn()}
			/>,
		);
		const list = screen.getByTestId("ai-plan-targets");
		const rows = list.querySelectorAll(":scope > li");
		expect(rows).toHaveLength(2);
		expect(rows[0].getAttribute("data-roadmap-id")).toBe("rm-a");
		expect(rows[1].getAttribute("data-roadmap-id")).toBe("rm-b");
		expect(screen.getByText("Roadmaps (2)")).toBeTruthy();
		expect(screen.getByText("Roadmap A")).toBeTruthy();
		expect(screen.getByText("Roadmap B")).toBeTruthy();
		expect(screen.getByText("1 change")).toBeTruthy();
		expect(screen.getByText("3 changes")).toBeTruthy();
		expect(screen.getAllByText("Includes deletes")).toHaveLength(1);
		expect(screen.getByText('Delete epic "Old" and 1 more')).toBeTruthy();
		// The mirrored hierarchy is labelled with the roadmap it belongs to.
		expect(screen.getByText("Proposed structure (Roadmap A)")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Apply this plan" }),
		).toBeTruthy();
	});

	it("keeps the legacy single-roadmap card unchanged when there are no targets", () => {
		render(
			<AiPlanProposalCard
				plan={legacyPlan}
				onApply={vi.fn()}
				onDiscard={vi.fn()}
			/>,
		);
		expect(screen.queryByTestId("ai-plan-targets")).toBeNull();
		expect(screen.getByText("Proposed structure")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Apply this plan" }),
		).toBeTruthy();
	});

	it("shows a single target's summary lines under 'Changes'", () => {
		render(
			<AiPlanProposalCard
				plan={{
					...legacyPlan,
					kind: "edits",
					targets: [twoRoadmapEdits.targets?.[1] as never],
				}}
				onApply={vi.fn()}
				onDiscard={vi.fn()}
			/>,
		);
		expect(screen.getByText("Changes")).toBeTruthy();
		expect(screen.getByText('Add epic "PW-Dash"')).toBeTruthy();
		expect(screen.getByText("Includes deletes")).toBeTruthy();
		expect(screen.getByText("Proposed structure")).toBeTruthy();
	});
});

describe("AiPlanProposalCard proposed task assignees", () => {
	it("renders the full assignee_labels list, falling back to assignee_label", () => {
		render(
			<AiPlanProposalCard
				plan={{
					...legacyPlan,
					proposed_hierarchy: [
						{
							title: "Onboarding",
							features: [
								{
									title: "Welcome flow",
									tasks: [
										{
											title: "Pair on the copy",
											assignee_labels: ["Ana", "Ben", "Cid"],
											// The legacy label loses to the list.
											assignee_label: "Dan",
										},
										{ title: "Ship it", assignee_label: "Ana" },
										{ title: "Nobody yet", assignee_labels: [] },
									],
								},
							],
						},
					],
				}}
				onApply={vi.fn()}
				onDiscard={vi.fn()}
			/>,
		);
		const chips = screen.getAllByTestId("ai-plan-task-assignees");
		expect(chips).toHaveLength(2);
		expect(chips[0].textContent).toBe("3 assignees: Ana, Ben, and Cid");
		expect(chips[1].textContent).toBe("assigned to Ana");
		expect(screen.queryByText(/Dan/)).toBeNull();
	});
});
