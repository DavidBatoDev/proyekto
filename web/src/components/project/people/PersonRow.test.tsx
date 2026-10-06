/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DELIVERY_TEAM_MEMBER_LABEL,
	isMaskedMemberId,
	PersonRow,
} from "./PersonRow";
import type { PersonAccess } from "./useProjectPeople";

function person(over: Partial<PersonAccess> = {}): PersonAccess {
	return {
		key: "u1",
		userId: "u1",
		memberId: "row-1",
		rows: [],
		user: {
			id: "u1",
			display_name: "Maria Santos",
			avatar_url: null,
			email: "maria@example.test",
			first_name: null,
			last_name: null,
		},
		role: "editor",
		position: null,
		isExternal: false,
		isSelf: false,
		likelyCanEdit: true,
		canEditPermissions: true,
		canEditPosition: true,
		canRemove: true,
		sources: [],
		teamIds: [],
		...over,
	};
}

afterEach(() => cleanup());

describe("isMaskedMemberId", () => {
	it.each([
		["masked:row-9", true],
		["masked:", true],
		["u1", false],
		["", false],
		[null, false],
		[undefined, false],
	])("%s → %s", (id, expected) => {
		expect(isMaskedMemberId(id)).toBe(expected);
	});
});

describe("PersonRow", () => {
	it("opens the access drawer for a named person", () => {
		const onOpen = vi.fn();
		render(<PersonRow person={person()} onOpen={onOpen} />);
		fireEvent.click(screen.getByRole("button", { name: /Maria Santos/ }));
		expect(onOpen).toHaveBeenCalledTimes(1);
		expect(screen.getByText("editor")).toBeTruthy();
	});

	it("reads a masked member as Delivery team member, with no actions (L22, E35)", () => {
		const onOpen = vi.fn();
		const { container } = render(
			<PersonRow
				person={person({
					key: "masked:row-9",
					userId: "masked:row-9",
					user: {
						id: "masked:row-9",
						display_name: DELIVERY_TEAM_MEMBER_LABEL,
						avatar_url: null,
						email: null,
						first_name: null,
						last_name: null,
					},
					isExternal: true,
				})}
				origin={{ label: "Pixel Studio" }}
				onOpen={onOpen}
			/>,
		);
		expect(screen.getByText("Delivery team member")).toBeTruthy();
		// Nothing to click, and nothing that narrows down who it is.
		expect(screen.queryByRole("button")).toBeNull();
		expect(screen.queryByText("editor")).toBeNull();
		expect(screen.queryByText("Pixel Studio")).toBeNull();
		expect(screen.queryByText("Not on a team")).toBeNull();
		expect(screen.queryByText("Can edit")).toBeNull();
		expect(container.querySelector("[data-masked-person]")).not.toBeNull();
		expect(onOpen).not.toHaveBeenCalled();
	});

	it("masks on the id even when the server left a stale name", () => {
		render(
			<PersonRow
				person={person({ userId: "masked:row-2" })}
				onOpen={() => {}}
			/>,
		);
		expect(screen.getByText("Delivery team member")).toBeTruthy();
		expect(screen.queryByText("Maria Santos")).toBeNull();
		expect(screen.queryByText(/maria@example/)).toBeNull();
	});
});
