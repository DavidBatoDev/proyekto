import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
	get: vi.fn(),
	post: vi.fn(),
	patch: vi.fn(),
}));

vi.mock("@/api/axios", () => ({ default: client }));

import { contractService } from "./contract.service";
import {
	contractHistoryService,
	formatDiffValue,
} from "./contract-history.service";

beforeEach(() => {
	client.get.mockReset();
	client.post.mockReset();
	client.patch.mockReset();
});

describe("two-way contract authoring client", () => {
	it("pins an edit to the revision the editor read with If-Match", async () => {
		client.patch.mockResolvedValue({
			data: { data: { id: "c1", positions: [], clauses: [], services: [] } },
		});

		await contractService.update("c1", { recurring_fee: 5 }, 7);

		expect(client.patch).toHaveBeenCalledWith(
			"/api/contracts/c1",
			{ recurring_fee: 5 },
			{ headers: { "If-Match": "7" } },
		);
	});

	it("sends no If-Match when the caller does not know the revision", async () => {
		client.patch.mockResolvedValue({
			data: { data: { id: "c1", positions: [], clauses: [], services: [] } },
		});

		await contractService.update("c1", { recurring_fee: 5 });

		expect(client.patch).toHaveBeenCalledWith(
			"/api/contracts/c1",
			{ recurring_fee: 5 },
			undefined,
		);
	});

	it("records a review at a revision", async () => {
		client.post.mockResolvedValue({ data: { data: {} } });
		await contractHistoryService.markViewed("c1", 4);
		expect(client.post).toHaveBeenCalledWith("/api/contracts/c1/viewed", {
			revision: 4,
		});
	});

	it("surfaces the server's refusal of a second amendment", async () => {
		client.post.mockRejectedValue(
			Object.assign(new Error("409"), {
				response: {
					status: 409,
					data: {
						error: {
							message:
								"An amendment to this contract is already open. Edit that amendment instead of starting another.",
						},
					},
				},
			}),
		);
		await expect(contractHistoryService.send("c1")).rejects.toThrow(
			/already open/,
		);
	});

	it("reads the frozen PDF's hash check from the response headers", async () => {
		const createObjectURL = vi.fn(() => "blob:pdf");
		vi.stubGlobal("URL", { ...URL, createObjectURL });
		client.get.mockResolvedValue({
			data: new Blob(["%PDF"]),
			headers: {
				"x-content-sha256": "a".repeat(64),
				"x-snapshot-verified": "true",
				"x-snapshot-kind": "at_signing",
				"x-snapshot-taken-at": "2026-09-30T00:00:00Z",
			},
		});

		const pdf = await contractHistoryService.signedPdf("c1");

		expect(pdf).toEqual(
			expect.objectContaining({
				url: "blob:pdf",
				verified: true,
				kind: "at_signing",
			}),
		);
		vi.unstubAllGlobals();
	});
});

describe("formatDiffValue", () => {
	it("says values the way a reader would", () => {
		expect(formatDiffValue(null)).toBe("—");
		expect(formatDiffValue("")).toBe("—");
		expect(formatDiffValue(true)).toBe("Yes");
		expect(formatDiffValue(95)).toBe("95");
		expect(formatDiffValue([1, 2])).toBe("2 items");
	});
});
