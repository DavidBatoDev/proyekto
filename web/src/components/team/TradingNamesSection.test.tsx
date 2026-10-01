/* @vitest-environment jsdom */

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TradingNamesSection } from "./TradingNamesSection";

describe("TradingNamesSection", () => {
	afterEach(cleanup);

	it("adds a trading name, keeping the existing ones", async () => {
		const onSave = vi.fn().mockResolvedValue(undefined);
		render(
			<TradingNamesSection
				teamName="JC Studio"
				names={["Pro Digi"]}
				canEdit
				saving={false}
				onSave={onSave}
			/>,
		);
		fireEvent.change(screen.getByLabelText("Add a trading name"), {
			target: { value: "  PRODIGITALITY " },
		});
		fireEvent.click(screen.getByRole("button", { name: /Add/ }));
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith(["Pro Digi", "PRODIGITALITY"]),
		);
	});

	it("removes a trading name", () => {
		const onSave = vi.fn().mockResolvedValue(undefined);
		render(
			<TradingNamesSection
				teamName="JC Studio"
				names={["PRODIGITALITY", "Pro Digi"]}
				canEdit
				saving={false}
				onSave={onSave}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Remove Pro Digi" }));
		expect(onSave).toHaveBeenCalledWith(["PRODIGITALITY"]);
	});

	it("is read-only for anyone but the owner", () => {
		render(
			<TradingNamesSection
				teamName="JC Studio"
				names={["PRODIGITALITY"]}
				canEdit={false}
				saving={false}
				onSave={vi.fn()}
			/>,
		);
		expect(screen.getByText("PRODIGITALITY")).toBeTruthy();
		expect(screen.queryByLabelText("Add a trading name")).toBeNull();
		expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
	});
});
