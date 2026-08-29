import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	pendingCount,
	pendingFromFile,
	pendingFromUrls,
	srcOf,
	uploadPending,
} from "./pendingImages";

function file(name: string): File {
	return new File(["x"], name, { type: "image/png" });
}

beforeEach(() => {
	let counter = 0;
	globalThis.URL.createObjectURL = vi.fn(() => `blob:preview-${++counter}`);
	globalThis.URL.revokeObjectURL = vi.fn();
});

describe("pendingFromUrls", () => {
	it("drops the empty slots a nullable cover leaves behind", () => {
		expect(pendingFromUrls([null, "a.png", undefined, "b.png"])).toHaveLength(
			2,
		);
	});
});

describe("srcOf", () => {
	it("shows the local preview until the image has a real URL", () => {
		const pending = pendingFromFile(file("shot.png"));

		expect(srcOf(pending)).toBe(pending.previewUrl);
		expect(srcOf({ key: "k", url: "https://cdn/x.png" })).toBe(
			"https://cdn/x.png",
		);
	});
});

describe("uploadPending", () => {
	it("uploads only the local files and keeps display order", async () => {
		const upload = vi.fn(async (f: File) => `https://cdn/${f.name}`);
		const items = [
			{ key: "a", url: "https://cdn/kept.png" },
			pendingFromFile(file("new.png")),
		];

		const result = await uploadPending(items, upload);

		expect(upload).toHaveBeenCalledTimes(1);
		expect(result.uploaded).toEqual([
			"https://cdn/kept.png",
			"https://cdn/new.png",
		]);
		expect(result.error).toBeNull();
		expect(pendingCount(result.items)).toBe(0);
	});

	/**
	 * The reason successes are written back rather than discarded: without it,
	 * hitting Save again after one failure re-uploads the images that already
	 * landed, orphaning the first copies — exactly the leak this module exists
	 * to prevent.
	 */
	it("keeps what landed when a sibling upload fails, and reports the failure", async () => {
		const upload = vi.fn(async (f: File) => {
			if (f.name === "bad.png") throw new Error("upload failed");
			return `https://cdn/${f.name}`;
		});
		const items = [
			pendingFromFile(file("good.png")),
			pendingFromFile(file("bad.png")),
		];

		const result = await uploadPending(items, upload);

		expect(result.error).toBeInstanceOf(Error);
		expect(result.items[0].url).toBe("https://cdn/good.png");
		expect(result.items[0].file).toBeUndefined();
		expect(result.items[1].file).toBeDefined();

		// A retry only re-sends the one that failed.
		upload.mockClear();
		const retry = await uploadPending(
			result.items,
			async (f) => `https://cdn/${f.name}`,
		);
		expect(retry.uploaded).toEqual([
			"https://cdn/good.png",
			"https://cdn/bad.png",
		]);
	});

	it("is a no-op when nothing is pending", async () => {
		const upload = vi.fn();

		const result = await uploadPending(
			[{ key: "a", url: "https://cdn/a.png" }],
			upload,
		);

		expect(upload).not.toHaveBeenCalled();
		expect(result.uploaded).toEqual(["https://cdn/a.png"]);
	});
});
