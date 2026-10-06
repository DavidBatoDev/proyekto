/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PayoutMethod } from "@/services/payouts.service";
import { TimeApiError } from "@/services/time.service";

const mocks = vi.hoisted(() => ({
	native: false,
	user: { id: "payer-1" } as { id: string } | null,
	listMemberMethods: vi.fn(),
	createPayout: vi.fn(),
	uploadPayoutProof: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@/lib/platform", () => ({ isNativeApp: () => mocks.native }));

vi.mock("@/services/payouts.service", () => ({
	payoutsService: {
		listMemberMethods: mocks.listMemberMethods,
		createPayout: mocks.createPayout,
	},
}));

vi.mock("@/services/upload.service", () => ({
	uploadService: { uploadPayoutProof: mocks.uploadPayoutProof },
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({ success: mocks.toastSuccess, error: mocks.toastError }),
}));

vi.mock("@/stores/authStore", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/stores/authStore")>();
	return { ...actual, useUser: () => mocks.user };
});

import {
	cutoffForEntry,
	type PayableEntry,
	PayMemberModal,
	payoutTotal,
} from "./PayMemberModal";

const method: PayoutMethod = {
	id: "pm-1",
	user_id: "member-1",
	method_type: "bank",
	label: "Salary",
	account_name: "Juan Dela Cruz",
	account_identifier: "1234567890",
	bank_name: "BDO",
	currency: "PHP",
	qr_path: null,
	qr_url: null,
	is_default: true,
	is_archived: false,
	created_at: "2026-09-01T00:00:00.000Z",
	updated_at: "2026-09-01T00:00:00.000Z",
};

function entry(overrides: Partial<PayableEntry> = {}): PayableEntry {
	return {
		id: "entry-1",
		started_at: "2026-09-20T01:00:00.000Z",
		payable_seconds: 3600,
		duration_seconds: 3600,
		rate_snapshot: 100,
		currency_snapshot: "PHP",
		...overrides,
	};
}

let client: QueryClient;

function renderModal(
	props: Partial<Parameters<typeof PayMemberModal>[0]> = {},
) {
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const onSuccess = vi.fn();
	const utils = render(
		<QueryClientProvider client={client}>
			<PayMemberModal
				isOpen
				teamId="team-1"
				memberId="member-1"
				memberLabel="Juan Dela Cruz"
				currency="PHP"
				entries={[entry()]}
				timezone="Asia/Manila"
				onClose={() => {}}
				onSuccess={onSuccess}
				{...props}
			/>
		</QueryClientProvider>,
	);
	return { ...utils, onSuccess };
}

beforeEach(() => {
	mocks.listMemberMethods.mockResolvedValue([method]);
	mocks.createPayout.mockResolvedValue({
		id: "payout-1",
		total_amount: 100,
		currency: "PHP",
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	mocks.native = false;
	mocks.user = { id: "payer-1" };
});

describe("payoutTotal", () => {
	it("rounds once on the sum, the way the payment RPC does (L63)", () => {
		// 3 × 1h × 33.333 = 99.999 → 100.00. Rounding each entry first
		// (33.33 × 3) would record 99.99.
		const entries = ["a", "b", "c"].map((id) =>
			entry({ id, payable_seconds: 3600, rate_snapshot: 33.333 }),
		);
		expect(payoutTotal(entries)).toBe(100);
	});

	it("pays approved (payable) time, never the raw duration", () => {
		expect(
			payoutTotal([entry({ payable_seconds: 1800, duration_seconds: 3600 })]),
		).toBe(50);
	});

	it("reads the duration only for old alias rows that carry no payable time", () => {
		expect(
			payoutTotal([
				entry({ payable_seconds: undefined, duration_seconds: 7200 }),
			]),
		).toBe(200);
	});

	it("counts no money for a missing or zero rate", () => {
		expect(payoutTotal([entry({ rate_snapshot: undefined })])).toBe(0);
		expect(payoutTotal([entry({ rate_snapshot: 0 })])).toBe(0);
	});
});

describe("cutoffForEntry", () => {
	it("counts the day in the team's time zone, not the browser's (L65)", () => {
		// 17:30 UTC on Sep 15 is 01:30 on Sep 16 in Manila.
		const manila = cutoffForEntry(
			"2026-09-15T17:30:00.000Z",
			null,
			"Asia/Manila",
		);
		expect(manila.from).toBe("2026-09-16");
		expect(manila.to).toBe("2026-09-30");
		expect(manila.payDate).toBe("2026-10-07");
		const utc = cutoffForEntry("2026-09-15T17:30:00.000Z", null, "UTC");
		expect(utc.from).toBe("2026-09-01");
		expect(utc.to).toBe("2026-09-15");
	});
});

describe("PayMemberModal", () => {
	it("shows the member's payout methods on the web", async () => {
		renderModal();

		expect(await screen.findByRole("combobox")).toBeTruthy();
		expect(mocks.listMemberMethods).toHaveBeenCalledWith("team-1", "member-1");
		expect(screen.getAllByText(/Juan Dela Cruz/).length).toBeGreaterThan(0);
		expect(screen.getByTestId("pay-total").textContent).toBe("PHP 100.00");
	});

	it("records the payment with entry_ids and refreshes the payout caches", async () => {
		const { onSuccess } = renderModal({
			entries: [
				entry({ id: "e1" }),
				entry({ id: "e2", payable_seconds: 1800 }),
			],
		});
		const spy = vi.spyOn(client, "invalidateQueries");
		await screen.findByRole("combobox");

		fireEvent.click(screen.getByRole("button", { name: /record payout/i }));

		await waitFor(() => expect(mocks.createPayout).toHaveBeenCalledTimes(1));
		const body = mocks.createPayout.mock.calls[0][0];
		expect(body).toMatchObject({
			team_id: "team-1",
			member_user_id: "member-1",
			entry_ids: ["e1", "e2"],
			payout_method_id: "pm-1",
			source: "batch",
		});
		expect(body).not.toHaveProperty("log_ids");
		// The paid date is midday that day, so it reads the same in every zone.
		expect(body.paid_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
		expect(mocks.toastSuccess).toHaveBeenCalledWith(
			"Recorded a payment of PHP 100.00 to Juan Dela Cruz.",
		);
		expect(spy).toHaveBeenCalledWith({ queryKey: ["payouts"] });
	});

	it("still takes the old `logs` prop from the pages that haven't moved yet", async () => {
		renderModal({
			entries: undefined,
			logs: [entry({ id: "old-1", payable_seconds: undefined })],
		});
		await screen.findByRole("combobox");
		fireEvent.click(screen.getByRole("button", { name: /record payout/i }));
		await waitFor(() => expect(mocks.createPayout).toHaveBeenCalledTimes(1));
		expect(mocks.createPayout.mock.calls[0][0].entry_ids).toEqual(["old-1"]);
	});

	it("never offers a self-payment (CHANGE-9)", () => {
		mocks.user = { id: "member-1" };
		renderModal();

		expect(
			screen.getByText("Someone else on the team has to record your payment."),
		).toBeTruthy();
		const record = screen.getByRole("button", {
			name: /record payout/i,
		}) as HTMLButtonElement;
		expect(record.disabled).toBe(true);
		expect(mocks.listMemberMethods).not.toHaveBeenCalled();
	});

	it("says when some of the person's time in the period isn't approved yet", () => {
		renderModal({ unapprovedSeconds: 9000 });
		expect(
			screen.getByText(
				"2h 30m of Juan's time in this period isn't approved yet. It isn't part of this payment; pay it once it's approved.",
			),
		).toBeTruthy();
	});

	it("breaks a payment across several cut-offs down", async () => {
		renderModal({
			entries: [
				entry({ id: "a", started_at: "2026-09-02T02:00:00.000Z" }),
				entry({ id: "b", started_at: "2026-09-20T02:00:00.000Z" }),
			],
		});
		expect(await screen.findByText("Across 2 cut-offs")).toBeTruthy();
		expect(screen.getByTestId("pay-total").textContent).toBe("PHP 200.00");
	});

	it("words a refusal through the time copy", async () => {
		mocks.createPayout.mockRejectedValueOnce(
			new TimeApiError({
				status: 422,
				code: "FIXED_RATE_NOT_PAYABLE_BY_ENTRY",
				message: "raw",
			}),
		);
		renderModal();
		await screen.findByRole("combobox");
		fireEvent.click(screen.getByRole("button", { name: /record payout/i }));
		await waitFor(() =>
			expect(mocks.toastError).toHaveBeenCalledWith(
				"Fixed-fee time is paid as a manual payment, not by entry.",
			),
		);
	});

	it("leaves a plan refusal to the app-wide upgrade prompt", async () => {
		mocks.createPayout.mockRejectedValueOnce(
			new TimeApiError({
				status: 403,
				code: "plan_limit",
				message: "Payouts are part of Business.",
			}),
		);
		renderModal();
		await screen.findByRole("combobox");
		fireEvent.click(screen.getByRole("button", { name: /record payout/i }));
		await waitFor(() => expect(mocks.createPayout).toHaveBeenCalledTimes(1));
		await waitFor(() =>
			expect(
				(
					screen.getByRole("button", {
						name: /record payout/i,
					}) as HTMLButtonElement
				).disabled,
			).toBe(false),
		);
		expect(mocks.toastError).not.toHaveBeenCalled();
	});

	it("in the installed app, points to the web and never shows or fetches payout details", () => {
		mocks.native = true;
		renderModal();

		expect(
			screen.getByText("Open Proyekto on the web to do this."),
		).toBeTruthy();
		expect(screen.queryByRole("combobox")).toBeNull();
		expect(screen.queryByText(/Juan Dela Cruz/)).toBeNull();
		expect(screen.queryByText(/7890/)).toBeNull();
		expect(screen.queryByRole("button", { name: /record/i })).toBeNull();
		expect(mocks.listMemberMethods).not.toHaveBeenCalled();
		const text = document.body.textContent ?? "";
		expect(text).not.toMatch(/\b(contract|rate|payout|invoice)s?\b/i);
		expect(text).not.toMatch(/PHP\s?\d/);
	});
});
