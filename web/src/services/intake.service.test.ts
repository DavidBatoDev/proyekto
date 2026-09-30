import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
	get: vi.fn(),
	post: vi.fn(),
	patch: vi.fn(),
}));

vi.mock("@/api/axios", () => ({ default: client }));

import { intakeService, isBlocking, type ReviewField } from "./intake.service";

const field = (state: ReviewField["state"]): ReviewField => ({
	value: state === "needs_input" ? null : "x",
	state,
	origin: "ai",
	confidence: 0.5,
	ai_value: "x",
	page: 1,
	box: null,
});

beforeEach(() => {
	client.get.mockReset();
	client.post.mockReset();
	client.patch.mockReset();
});

describe("document intake client", () => {
	it("only Unsure and Needs input block Confirm", () => {
		expect(isBlocking(field("unsure"))).toBe(true);
		expect(isBlocking(field("needs_input"))).toBe(true);
		expect(isBlocking(field("read"))).toBe(false);
		expect(isBlocking(field("corrected"))).toBe(false);
		expect(isBlocking(field("not_in_document"))).toBe(false);
	});

	it("uploads many files in one multipart request", async () => {
		client.post.mockResolvedValue({ data: { data: [] } });
		const files = [
			new File(["%PDF-"], "contract.pdf", { type: "application/pdf" }),
			new File(["png"], "receipt.png", { type: "image/png" }),
		];

		await intakeService.upload("batch-1", files);

		const [url, body] = client.post.mock.calls[0];
		expect(url).toBe("/api/intake/batches/batch-1/files");
		expect((body as FormData).getAll("files")).toHaveLength(2);
	});

	it("records a value read from a drawn box as a snip", async () => {
		client.patch.mockResolvedValue({ data: { data: {} } });
		await intakeService.updateField("doc-1", {
			field: "total",
			value: "3840",
			snip_page: 2,
			snip_box: [0.1, 0.2, 0.3, 0.05],
		});
		expect(client.patch).toHaveBeenCalledWith(
			"/api/intake/documents/doc-1/fields",
			expect.objectContaining({
				snip_page: 2,
				snip_box: [0.1, 0.2, 0.3, 0.05],
			}),
		);
	});

	it("surfaces the server's reason when replicate refuses", async () => {
		client.post.mockRejectedValue(
			Object.assign(new Error("400"), {
				response: {
					data: {
						error: {
							message:
								"Confirm the counterparty and project for this group first.",
						},
					},
				},
			}),
		);
		await expect(intakeService.replicate("rel-1")).rejects.toThrow(
			/Confirm the counterparty/,
		);
	});
});
