/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InitialsPad, initialsFromName } from "./InitialsPad";

afterEach(cleanup);

describe("initialsFromName", () => {
	it("takes the first letter of each name part", () => {
		expect(initialsFromName("Juan Carlos Gan")).toBe("JCG");
		expect(initialsFromName("Alina Reyes")).toBe("AR");
	});

	it("caps at four parts so a long name cannot overflow the stamp", () => {
		expect(initialsFromName("A B C D E F")).toBe("ABCD");
	});

	it("survives empty, missing and whitespace-only names", () => {
		expect(initialsFromName(null)).toBe("");
		expect(initialsFromName(undefined)).toBe("");
		expect(initialsFromName("   ")).toBe("");
	});
});

describe("InitialsPad", () => {
	it("offers only the two methods that can be attributed to the signer", () => {
		render(<InitialsPad onCapture={vi.fn()} />);
		expect(screen.getByRole("button", { name: "Type" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Draw" })).toBeTruthy();
		// Uploading an image is deliberately absent — see the component's note.
		expect(screen.queryByText(/upload/i)).toBeNull();
	});

	it("seeds the typed mark from the signer's name", () => {
		render(<InitialsPad defaultText="JCG" onCapture={vi.fn()} />);
		expect(screen.getByDisplayValue("JCG")).toBeTruthy();
	});

	it("cannot be applied until there is something to stamp", () => {
		render(<InitialsPad onCapture={vi.fn()} />);
		const apply = screen.getByRole("button", { name: "Apply to every page" });
		expect((apply as HTMLButtonElement).disabled).toBe(true);
	});

	it("enables applying once initials are typed", () => {
		render(<InitialsPad defaultText="AR" onCapture={vi.fn()} />);
		const apply = screen.getByRole("button", { name: "Apply to every page" });
		expect((apply as HTMLButtonElement).disabled).toBe(false);
	});
});
