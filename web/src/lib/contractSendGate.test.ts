import { describe, expect, it } from "vitest";
import { contractSendBlockedReason } from "./contractSendGate";

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
