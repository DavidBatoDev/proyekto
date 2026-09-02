import { describe, expect, it } from "vitest";
import { groupByWorkspace } from "./workspaceScope";

const MINE = ["ws-a", "ws-b"];

function item(id: string, workspace_id: string | null) {
	return { id, workspace_id };
}

describe("groupByWorkspace", () => {
	it("puts items in the open workspace in the current list", () => {
		const result = groupByWorkspace(
			[item("1", "ws-a"), item("2", "ws-a")],
			"ws-a",
			MINE,
		);
		expect(result.current.map((i) => i.id)).toEqual(["1", "2"]);
		expect(result.shared).toEqual([]);
	});

	/**
	 * The consultant case: access to a client's project without membership in
	 * the client's workspace. Losing these would hide someone's whole book of
	 * work the day workspaces shipped.
	 */
	it("treats another organization's items as shared with you", () => {
		const result = groupByWorkspace([item("1", "ws-client")], "ws-a", MINE);
		expect(result.current).toEqual([]);
		expect(result.shared.map((i) => i.id)).toEqual(["1"]);
	});

	it("treats unhomed items as shared with you", () => {
		const result = groupByWorkspace([item("1", null)], "ws-a", MINE);
		expect(result.shared.map((i) => i.id)).toEqual(["1"]);
	});

	/** Visible when you switch to it — not lost, just not here. */
	it("hides items belonging to another workspace the viewer is a member of", () => {
		const result = groupByWorkspace([item("1", "ws-b")], "ws-a", MINE);
		expect(result.current).toEqual([]);
		expect(result.shared).toEqual([]);
	});

	it("falls back to one flat list when no workspace is selected", () => {
		const items = [item("1", "ws-a"), item("2", null), item("3", "ws-x")];
		const result = groupByWorkspace(items, null, MINE);
		expect(result.current).toHaveLength(3);
		expect(result.shared).toEqual([]);
	});

	it("handles an item with no workspace_id field at all", () => {
		const legacyRow: { id: string; workspace_id?: string | null } = { id: "1" };
		const result = groupByWorkspace([legacyRow], "ws-a", MINE);
		expect(result.shared).toHaveLength(1);
	});
});
