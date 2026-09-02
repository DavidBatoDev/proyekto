/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RichBody } from "./RichBody";

afterEach(cleanup);

/**
 * The whole point of this component is that a column can hold two formats at
 * once. Team descriptions written before the rich editor are plain text and
 * were deliberately not backfilled, so both branches are live in production
 * simultaneously — a regression in either one is visible to real users.
 */
describe("RichBody", () => {
	describe("legacy plain text", () => {
		it("renders as text, not as markup", () => {
			const { container } = render(
				<RichBody value="Our design team. Weekly sync Mondays." />,
			);
			expect(
				screen.getByText("Our design team. Weekly sync Mondays."),
			).toBeTruthy();
			expect(container.querySelector(".rich-prose")).toBeNull();
		});

		it("preserves line breaks, which a plain paragraph would collapse", () => {
			const { container } = render(<RichBody value={"One\nTwo"} />);
			const paragraph = container.querySelector("p");
			expect(paragraph?.className).toContain("whitespace-pre-wrap");
			expect(paragraph?.textContent).toBe("One\nTwo");
		});

		it("escapes text that merely mentions a tag rather than executing it", () => {
			const { container } = render(
				<RichBody value="Use the <script> tag carefully" />,
			);
			expect(container.querySelector("script")).toBeNull();
			expect(container.textContent).toContain("<script>");
		});
	});

	describe("rich HTML", () => {
		it("renders the formatting the editor produces", () => {
			const { container } = render(
				<RichBody value="<p><strong>Design</strong></p><ul><li>Mondays</li></ul>" />,
			);
			expect(container.querySelector("strong")?.textContent).toBe("Design");
			expect(container.querySelector("li")?.textContent).toBe("Mondays");
		});

		it("carries the rich-prose class, without which preflight strips list markers", () => {
			const { container } = render(<RichBody value="<p>hi</p>" />);
			expect(container.querySelector(".rich-prose")).not.toBeNull();
		});

		it("sanitizes at render, because the API accepts whatever a direct PATCH carries", () => {
			const { container } = render(
				<RichBody value='<p onclick="steal()">text</p><script>alert(1)</script>' />,
			);
			expect(container.querySelector("script")).toBeNull();
			expect(container.querySelector("p")?.getAttribute("onclick")).toBeNull();
			expect(container.textContent).toContain("text");
		});
	});
});
