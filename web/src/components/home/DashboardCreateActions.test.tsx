/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardCreateActions } from "./DashboardCreateActions";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		params,
		className,
	}: {
		children?: ReactNode;
		to: string;
		params?: Record<string, string>;
		className?: string;
	}) => (
		<a
			href={to.replace("$projectId", params?.projectId ?? "$projectId")}
			className={className}
		>
			{children}
		</a>
	),
}));

afterEach(cleanup);

describe("DashboardCreateActions", () => {
	it("links to project and standalone roadmap creation", () => {
		render(<DashboardCreateActions />);

		expect(
			screen
				.getByRole("link", { name: /create project/i })
				.getAttribute("href"),
		).toBe("/project-posting");
		expect(
			screen
				.getByRole("link", { name: /create roadmap/i })
				.getAttribute("href"),
		).toBe("/project/n/roadmap/create");
	});
});
