/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
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
		}: {
			children?: ReactNode;
			to: string;
			params?: Record<string, string>;
		}) => (
			<a href={to.replace("$engagementId", params?.engagementId ?? "")}>
				{children}
			</a>
		),
	};
});

import { sheetStatusView } from "@/lib/timeFormat";
import { ENGAGEMENT_ID, NOW, sheet, TZ } from "./__fixtures__/reviewFixtures";
import { ReviewHeader } from "./ReviewHeader";

afterEach(cleanup);

describe("ReviewHeader", () => {
	it("names the person, the scope and the period with its timezone", () => {
		const s = sheet();
		render(
			<ReviewHeader
				sheet={s}
				personName="Maria Santos"
				status={sheetStatusView(s, { now: NOW, userTimezone: TZ })}
				facts={["Submitted Sep 28, 10:14", "18:00", "4 projects"]}
				rules={{
					text: "Rules at submit: weekly · team owners & admins approve",
					engagementId: null,
				}}
				actions={<button type="button">Approve…</button>}
				now={NOW}
				userTimezone={TZ}
			/>,
		);
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
			"Maria Santos · Prodigitality Services Inc. Team · Sep 21 – 27, 2026 (Asia/Manila)",
		);
		expect(screen.getByTestId("review-status").textContent).toBe(
			"Submitted · Waiting on Prodigitality Services Inc. Team's owners and admins",
		);
		expect(screen.getByTestId("review-facts").textContent).toBe(
			"Submitted Sep 28, 10:14 · 18:00 · 4 projects",
		);
		expect(screen.getByTestId("review-rules").textContent).toBe(
			"Rules at submit: weekly · team owners & admins approve",
		);
		expect(screen.getByRole("button", { name: "Approve…" })).toBeTruthy();
	});

	it("labels agreement sheets and links the terms on web", () => {
		const s = sheet({
			scope_kind: "engagement",
			scope_label_snapshot: "Acme Corp",
		});
		render(
			<ReviewHeader
				sheet={s}
				personName={null}
				status={sheetStatusView(s, { now: NOW, userTimezone: TZ })}
				facts={[]}
				rules={{
					text: "Rules from your agreement with Acme Corp",
					engagementId: ENGAGEMENT_ID,
				}}
				native={false}
				now={NOW}
				userTimezone={TZ}
			/>,
		);
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
			"Acme Corp · agreement · Sep 21 – 27, 2026 (Asia/Manila)",
		);
		expect(
			screen.getByRole("link", { name: "View terms →" }).getAttribute("href"),
		).toBe(`/engagements/${ENGAGEMENT_ID}`);
	});

	it("says where an open sheet goes when there are no rules yet", () => {
		const s = sheet({ status: "open" });
		render(
			<ReviewHeader
				sheet={s}
				personName="Maria Santos"
				status={sheetStatusView(s, { now: NOW, userTimezone: TZ })}
				facts={["18:00"]}
				rules={null}
				goesTo="Goes to Prodigitality Services Inc. Team's owners and admins"
				now={NOW}
				userTimezone={TZ}
			/>,
		);
		expect(screen.getByTestId("review-goes-to").textContent).toBe(
			"Goes to Prodigitality Services Inc. Team's owners and admins",
		);
		expect(screen.getByTestId("review-status").textContent).toBe(
			"Open · overdue",
		);
	});

	it("shows the agreement's rules and where the sheet goes together", () => {
		const s = sheet({
			status: "open",
			scope_kind: "engagement",
			scope_label_snapshot: "Acme Corp",
		});
		render(
			<ReviewHeader
				sheet={s}
				personName={null}
				status={sheetStatusView(s, { now: NOW, userTimezone: TZ })}
				facts={["18:00"]}
				rules={{
					text: "Rules from your agreement with Acme Corp",
					engagementId: ENGAGEMENT_ID,
				}}
				goesTo="Goes to Ana Reyes"
				native={false}
				now={NOW}
				userTimezone={TZ}
			/>,
		);
		expect(screen.getByTestId("review-rules").textContent).toBe(
			"Rules from your agreement with Acme Corp · View terms →",
		);
		expect(screen.getByTestId("review-goes-to").textContent).toBe(
			"Goes to Ana Reyes",
		);
	});
});
