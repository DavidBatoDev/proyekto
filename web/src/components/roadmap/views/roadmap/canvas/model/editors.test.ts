import { describe, expect, it } from "vitest";
import type { CollaboratorInfo } from "@/hooks/useRoadmapCollaboration";
import { buildEditorsByNodeId, editingSignature } from "./editors";

const editor = (userId: string, editingNodeId?: string): CollaboratorInfo =>
	({ userId, name: userId, color: "#000", editingNodeId }) as CollaboratorInfo;

describe("editingSignature", () => {
	it("is empty when nobody is editing", () => {
		expect(editingSignature(undefined)).toBe("");
		expect(editingSignature([])).toBe("");
		expect(editingSignature([editor("u1")])).toBe("");
	});

	it("is stable regardless of collaborator array order", () => {
		// The whole point: presence updates reorder the array constantly, and an
		// unstable key here re-renders every node on the canvas.
		const a = editingSignature([editor("u1", "n1"), editor("u2", "n2")]);
		const b = editingSignature([editor("u2", "n2"), editor("u1", "n1")]);

		expect(a).toBe(b);
	});

	it("changes when someone starts editing a different node", () => {
		const before = editingSignature([editor("u1", "n1")]);
		const after = editingSignature([editor("u1", "n2")]);

		expect(after).not.toBe(before);
	});

	it("changes when an editor joins or leaves", () => {
		const one = editingSignature([editor("u1", "n1")]);
		const two = editingSignature([editor("u1", "n1"), editor("u2", "n1")]);

		expect(two).not.toBe(one);
	});

	it("ignores collaborators who are merely present", () => {
		const withIdle = editingSignature([editor("u1", "n1"), editor("idle")]);
		const withoutIdle = editingSignature([editor("u1", "n1")]);

		expect(withIdle).toBe(withoutIdle);
	});
});

describe("buildEditorsByNodeId", () => {
	it("returns an empty map for no editors", () => {
		expect(buildEditorsByNodeId(undefined).size).toBe(0);
		expect(buildEditorsByNodeId([]).size).toBe(0);
	});

	it("groups multiple editors on the same node", () => {
		const map = buildEditorsByNodeId([
			editor("u1", "n1"),
			editor("u2", "n1"),
			editor("u3", "n2"),
		]);

		expect(map.get("n1")?.map((e) => e.userId)).toEqual(["u1", "u2"]);
		expect(map.get("n2")?.map((e) => e.userId)).toEqual(["u3"]);
	});

	it("omits collaborators who are not editing anything", () => {
		const map = buildEditorsByNodeId([editor("u1"), editor("u2", "n1")]);

		expect(map.size).toBe(1);
		expect(map.has("n1")).toBe(true);
	});
});
