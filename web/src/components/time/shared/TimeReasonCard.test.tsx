/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { Clock } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import { TimeReasonCard } from "./TimeReasonCard";

afterEach(cleanup);

describe("TimeReasonCard", () => {
	it("states the reason as a status with its detail and action", () => {
		render(
			<TimeReasonCard
				tone="not-found"
				title="This timesheet doesn't exist or you can't open it."
				action={<button type="button">Back to Time</button>}
			>
				It may have been withdrawn.
			</TimeReasonCard>,
		);
		const card = screen.getByRole("status");
		expect(card.getAttribute("data-tone")).toBe("not-found");
		expect(
			screen.getByRole("heading", {
				name: "This timesheet doesn't exist or you can't open it.",
			}),
		).toBeTruthy();
		expect(card.textContent).toContain("It may have been withdrawn.");
		expect(screen.getByRole("button", { name: "Back to Time" })).toBeTruthy();
	});

	it("can announce a refusal that just happened", () => {
		render(<TimeReasonCard role="alert" tone="danger" title="Not allowed" />);
		expect(screen.getByRole("alert").getAttribute("data-tone")).toBe("danger");
	});

	it("shows the tone's icon, an override, or none", () => {
		const { container, rerender } = render(<TimeReasonCard title="A" />);
		expect(container.querySelectorAll("svg")).toHaveLength(1);

		rerender(<TimeReasonCard title="A" icon={Clock} />);
		expect(container.querySelector("svg")?.getAttribute("class")).toContain(
			"lucide-clock",
		);

		rerender(<TimeReasonCard title="A" icon={null} />);
		expect(container.querySelectorAll("svg")).toHaveLength(0);
	});

	it("colours with theme tokens only", () => {
		const { container } = render(
			<TimeReasonCard tone="warning" title="Locked" variant="inline" />,
		);
		const html = container.innerHTML;
		expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
		expect(html).toContain("text-warning");
		expect(html).toContain("bg-card");
	});
});
