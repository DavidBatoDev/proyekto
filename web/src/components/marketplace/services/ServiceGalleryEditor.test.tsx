/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pendingFromFile, pendingFromUrls } from "@/lib/pendingImages";
import { ServiceGalleryEditor } from "./ServiceGalleryEditor";

const uploadPortfolioImage = vi.fn();
const toastError = vi.fn();

vi.mock("@/services/upload.service", () => ({
	uploadService: {
		uploadPortfolioImage: (...args: unknown[]) => uploadPortfolioImage(...args),
	},
}));
vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({ error: toastError, success: vi.fn() }),
}));

function png(name: string): File {
	return new File(["x"], name, { type: "image/png" });
}

function pickFiles(files: File[]) {
	const input = document.querySelector<HTMLInputElement>('input[type="file"]');
	if (!input) throw new Error("file input missing");
	Object.defineProperty(input, "files", { value: files, configurable: true });
	fireEvent.change(input);
}

beforeEach(() => {
	vi.clearAllMocks();
	let counter = 0;
	globalThis.URL.createObjectURL = vi.fn(() => `blob:preview-${++counter}`);
	globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(cleanup);

describe("ServiceGalleryEditor", () => {
	/**
	 * The whole point of the deferred-upload change: an image the seller picks
	 * and then abandons must never reach R2, because nothing in this codebase
	 * deletes an orphaned object.
	 */
	it("uploads nothing when a file is picked", () => {
		const onAdd = vi.fn();
		render(
			<ServiceGalleryEditor
				items={[]}
				busy={false}
				onAdd={onAdd}
				onRemove={vi.fn()}
				onPromote={vi.fn()}
			/>,
		);

		pickFiles([png("shot.png")]);

		expect(uploadPortfolioImage).not.toHaveBeenCalled();
		expect(onAdd).toHaveBeenCalledWith([
			expect.objectContaining({ name: "shot.png" }),
		]);
	});

	it("rejects a wrong-typed file at pick time rather than at save", () => {
		const onAdd = vi.fn();
		render(
			<ServiceGalleryEditor
				items={[]}
				busy={false}
				onAdd={onAdd}
				onRemove={vi.fn()}
				onPromote={vi.fn()}
			/>,
		);

		pickFiles([new File(["x"], "notes.pdf", { type: "application/pdf" })]);

		expect(toastError).toHaveBeenCalledWith(
			expect.stringContaining("notes.pdf"),
		);
		expect(onAdd).not.toHaveBeenCalled();
	});

	it("marks a not-yet-uploaded image so the seller knows it is unsaved", () => {
		render(
			<ServiceGalleryEditor
				items={[pendingFromFile(png("new.png"))]}
				busy={false}
				onAdd={vi.fn()}
				onRemove={vi.fn()}
				onPromote={vi.fn()}
			/>,
		);

		expect(screen.getByText("Not saved yet")).toBeTruthy();
	});

	it("shows no unsaved badge for images that are already persisted", () => {
		render(
			<ServiceGalleryEditor
				items={pendingFromUrls(["https://cdn/a.png"])}
				busy={false}
				onAdd={vi.fn()}
				onRemove={vi.fn()}
				onPromote={vi.fn()}
			/>,
		);

		expect(screen.queryByText("Not saved yet")).toBeNull();
	});
});
