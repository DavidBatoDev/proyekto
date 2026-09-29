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
import type { TaskTimeLog } from "@/services/team-time.service";

const mocks = vi.hoisted(() => ({
	native: false,
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

import { PayMemberModal } from "./PayMemberModal";

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

const log = {
	id: "log-1",
	started_at: "2026-09-20T01:00:00.000Z",
	ended_at: "2026-09-20T02:00:00.000Z",
	duration_seconds: 3600,
	status: "approved",
	currency_snapshot: "PHP",
	rate_snapshot: 100,
} as unknown as TaskTimeLog;

function renderModal() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<PayMemberModal
				isOpen
				teamId="team-1"
				memberId="member-1"
				memberLabel="Juan"
				currency="PHP"
				logs={[log]}
				onClose={() => {}}
				onSuccess={() => {}}
			/>
		</QueryClientProvider>,
	);
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
});

describe("PayMemberModal payout details", () => {
	it("shows the member's payout methods on the web", async () => {
		renderModal();

		expect(await screen.findByRole("combobox")).toBeTruthy();
		expect(mocks.listMemberMethods).toHaveBeenCalledWith("team-1", "member-1");
		expect(screen.getByText(/Juan Dela Cruz/)).toBeTruthy();
	});

	it("never fetches or shows payout details in the installed app", async () => {
		mocks.native = true;
		renderModal();

		expect(
			screen.getByText(/payout details are shown on the web/i),
		).toBeTruthy();
		expect(screen.queryByRole("combobox")).toBeNull();
		expect(screen.queryByText(/Juan Dela Cruz/)).toBeNull();
		expect(screen.queryByText(/7890/)).toBeNull();
		expect(mocks.listMemberMethods).not.toHaveBeenCalled();
	});

	it("still records the payout in the app, without a method", async () => {
		mocks.native = true;
		renderModal();

		fireEvent.click(screen.getByRole("button", { name: /record payout/i }));

		await waitFor(() => expect(mocks.createPayout).toHaveBeenCalledTimes(1));
		expect(mocks.createPayout.mock.calls[0][0]).toMatchObject({
			team_id: "team-1",
			member_user_id: "member-1",
			log_ids: ["log-1"],
			payout_method_id: undefined,
		});
	});
});
