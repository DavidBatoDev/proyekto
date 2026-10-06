/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
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
		}) => {
			let href = to;
			for (const [key, value] of Object.entries(params ?? {})) {
				href = href.replace(`$${key}`, value);
			}
			return (
				<a href={href} className={className}>
					{children}
				</a>
			);
		},
	};
});

import { StaleRevisionBanner } from "./StaleRevisionBanner";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("StaleRevisionBanner", () => {
	it("names the person and offers Review the latest", () => {
		const onReviewLatest = vi.fn();
		render(
			<StaleRevisionBanner
				personName="Maria Santos"
				onReviewLatest={onReviewLatest}
			/>,
		);
		const banner = screen.getByRole("alert");
		expect(banner.textContent).toContain(
			"Maria changed this timesheet while you were looking.",
		);
		fireEvent.click(screen.getByRole("button", { name: "Review the latest" }));
		expect(onReviewLatest).toHaveBeenCalledTimes(1);
		expect(banner.className).toContain("border-warning/30");
	});

	it("without a person it stays neutral", () => {
		render(<StaleRevisionBanner />);
		expect(screen.getByRole("alert").textContent).toBe(
			"This timesheet changed while you were looking.",
		);
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("the bulk form links to the changed sheet", () => {
		render(
			<StaleRevisionBanner
				message="Nothing was approved: Leo Cruz's timesheet changed."
				actionLabel="Review"
				reviewTimesheetId="s2"
			/>,
		);
		const link = screen.getByRole("link", { name: "Review" });
		expect(link.getAttribute("href")).toBe("/time/timesheets/s2");
		expect(screen.getByRole("alert").textContent).toContain(
			"Nothing was approved: Leo Cruz's timesheet changed.",
		);
	});

	it("busy disables the button; dismiss and the danger tone work", () => {
		const onDismiss = vi.fn();
		render(
			<StaleRevisionBanner
				onReviewLatest={vi.fn()}
				busy
				tone="danger"
				onDismiss={onDismiss}
				message="Proyekto couldn't save this time. Try again."
			/>,
		);
		expect(
			(
				screen.getByRole("button", {
					name: "Review the latest",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		expect(screen.getByRole("alert").className).toContain(
			"border-destructive/30",
		);
		fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});
});
