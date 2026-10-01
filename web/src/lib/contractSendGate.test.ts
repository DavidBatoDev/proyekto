import { describe, expect, it } from "vitest";
import {
	contractMissingForSend,
	contractSendBlockedReason,
} from "./contractSendGate";

describe("contractSendBlockedReason", () => {
	it("blocks a client-authored draft while the consultant is unverified", () => {
		expect(
			contractSendBlockedReason({
				created_by: "client",
				consultant_user_id: "consultant",
				consultant_verification: { verified: false, name: "Dev Consultant" },
			}),
		).toBe("Waiting for Dev Consultant's verification");
	});

	it("lets it go once the consultant is verified", () => {
		expect(
			contractSendBlockedReason({
				created_by: "client",
				consultant_user_id: "consultant",
				consultant_verification: { verified: true, name: "Dev Consultant" },
			}),
		).toBeNull();
	});

	it("never blocks the consultant's own drafts", () => {
		expect(
			contractSendBlockedReason({
				created_by: "consultant",
				consultant_user_id: "consultant",
				consultant_verification: { verified: false, name: "Dev Consultant" },
			}),
		).toBeNull();
	});
});

describe("contractMissingForSend", () => {
	const ready = {
		service_start_date: "2026-10-01",
		term_count: 12,
		term_unit: "month" as const,
		service_end_date: "2027-09-30",
		billing_mode: "retainer" as const,
		fixed_fee: null,
		recurring_fee: 1000,
		client_hourly_rate: null,
	};

	it("is empty when the contract can be signed", () => {
		expect(contractMissingForSend(ready)).toEqual([]);
	});

	it("lists a missing start date and term", () => {
		expect(
			contractMissingForSend({
				...ready,
				service_start_date: null,
				term_count: null,
				service_end_date: null,
			}),
		).toEqual(["Service start date", "Term (how long the service runs)"]);
	});

	it("lists the amount the billing mode needs", () => {
		expect(
			contractMissingForSend({
				...ready,
				billing_mode: "hybrid",
				recurring_fee: null,
				client_hourly_rate: null,
			}),
		).toEqual(["Monthly contract rate", "Hourly contract rate"]);
	});
});
