/* @vitest-environment jsdom */

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ available: vi.fn() }));

vi.mock("../../../lib/auth-api", () => ({
	checkEmailAvailable: mocks.available,
}));
vi.mock("../../../hooks/useGoogleSignIn", () => ({
	useGoogleSignIn: () => ({ signIn: vi.fn() }),
}));
vi.mock("../../../hooks/useAppleSignIn", () => ({
	useAppleSignIn: () => ({ signIn: vi.fn(), isAvailable: false }),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: React.ReactNode }) => (
		<a href="/">{children}</a>
	),
}));

import { SignupStepAccount } from "./SignupStepAccount";

function Harness({ onNext }: { onNext: () => void }) {
	const [firstName, setFirstName] = useState("Ada");
	const [lastName, setLastName] = useState("Lovelace");
	const [email, setEmail] = useState("ada@example.com");
	return (
		<SignupStepAccount
			firstName={firstName}
			setFirstName={setFirstName}
			lastName={lastName}
			setLastName={setLastName}
			email={email}
			setEmail={setEmail}
			onNext={onNext}
		/>
	);
}

// "Continue →", not "Continue with Google".
const continueButton = () =>
	screen.getByRole("button", { name: /^continue(?! with)/i });

describe("SignupStepAccount email check", () => {
	beforeEach(() => mocks.available.mockReset());
	afterEach(cleanup);

	it("moves on when the email is free", async () => {
		mocks.available.mockResolvedValue(true);
		const onNext = vi.fn();
		render(<Harness onNext={onNext} />);

		fireEvent.click(continueButton());

		await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1));
		expect(mocks.available).toHaveBeenCalledWith("ada@example.com");
	});

	it("stops on a taken email and offers to sign in instead", async () => {
		mocks.available.mockResolvedValue(false);
		const onNext = vi.fn();
		render(<Harness onNext={onNext} />);

		fireEvent.click(continueButton());

		await waitFor(() =>
			expect(
				screen.getByText("An account with this email already exists."),
			).toBeTruthy(),
		);
		expect(screen.getByText("Sign in instead")).toBeTruthy();
		expect(onNext).not.toHaveBeenCalled();
		expect((continueButton() as HTMLButtonElement).disabled).toBe(true);
	});

	it("clears the message once the email is changed", async () => {
		mocks.available.mockResolvedValue(false);
		render(<Harness onNext={vi.fn()} />);
		fireEvent.click(continueButton());
		await waitFor(() => screen.getByText("Sign in instead"));

		fireEvent.change(screen.getByLabelText(/email/i), {
			target: { value: "ada.new@example.com" },
		});

		expect(screen.queryByText("Sign in instead")).toBeNull();
		expect(
			screen.queryByText("An account with this email already exists."),
		).toBeNull();
		expect((continueButton() as HTMLButtonElement).disabled).toBe(false);
	});

	it("lets the person continue when the check itself fails", async () => {
		mocks.available.mockResolvedValue(null);
		const onNext = vi.fn();
		render(<Harness onNext={onNext} />);

		fireEvent.click(continueButton());

		await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1));
	});
});
