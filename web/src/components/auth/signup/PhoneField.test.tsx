/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isAcceptablePhone, PhoneField } from "./PhoneField";

describe("isAcceptablePhone", () => {
	it("accepts an empty number — the field is optional", () => {
		expect(isAcceptablePhone("", "PH")).toBe(true);
		expect(isAcceptablePhone("   ", "")).toBe(true);
	});

	it("accepts a real number for the country", () => {
		expect(isAcceptablePhone("+639171234567", "PH")).toBe(true);
		expect(isAcceptablePhone("+61412345678", "AU")).toBe(true);
	});

	it("rejects a half-typed number", () => {
		expect(isAcceptablePhone("+63917", "PH")).toBe(false);
	});

	it("rejects a number with no country to check it against", () => {
		expect(isAcceptablePhone("+639171234567", "")).toBe(false);
	});
});

describe("PhoneField", () => {
	afterEach(cleanup);

	it("says it is optional and shows no error when left empty", () => {
		render(<PhoneField country="PH" value="" onChange={vi.fn()} />);
		expect(screen.getByText("(optional)")).toBeTruthy();

		const input = screen.getByLabelText("Phone number");
		fireEvent.focus(input);
		fireEvent.blur(input);
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("still flags an invalid number once one is typed", () => {
		render(<PhoneField country="PH" value="+63917" onChange={vi.fn()} />);
		const input = screen.getByLabelText("Phone number");
		fireEvent.focus(input);
		fireEvent.blur(input);
		expect(screen.getByRole("alert").textContent).toMatch(/valid phone number/);
	});
});
