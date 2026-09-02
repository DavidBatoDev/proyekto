/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { generateRoadmapThumbnailDataUri } from "@/lib/roadmapThumbnail";
import { TemplateCoverImage } from "./TemplateCoverImage";

afterEach(cleanup);

describe("TemplateCoverImage", () => {
	it("renders a real cover photo", () => {
		render(
			<TemplateCoverImage
				src="https://cdn.proyekto.tech/stock/saas/05.jpg"
				alt="SaaS MVP Launch"
			/>,
		);

		expect(
			screen.getByRole("img", { name: "SaaS MVP Launch" }).getAttribute("src"),
		).toBe("https://cdn.proyekto.tech/stock/saas/05.jpg");
	});

	it.each([
		["nothing", undefined],
		["null", null],
		["whitespace", "   "],
	])("renders nothing for %s", (_label, src) => {
		const { container } = render(<TemplateCoverImage src={src} />);
		expect(container.innerHTML).toBe("");
	});

	it("renders nothing for the generated gradient placeholder", () => {
		// A gradient with the roadmap's initial is not a picture of anything, and
		// the card reads better with the space back.
		const { container } = render(
			<TemplateCoverImage
				src={generateRoadmapThumbnailDataUri("seed", "SaaS MVP Launch")}
			/>,
		);
		expect(container.innerHTML).toBe("");
	});

	it("removes itself when the image fails to load", () => {
		const { container } = render(
			<TemplateCoverImage src="https://cdn.proyekto.tech/stock/saas/99.jpg" />,
		);

		fireEvent.error(container.querySelector("img") as HTMLImageElement);

		expect(container.innerHTML).toBe("");
	});
});
