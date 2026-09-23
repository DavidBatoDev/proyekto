/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above every const in this file, so the spies it closes
// over have to be created inside vi.hoisted.
const mocks = vi.hoisted(() => ({
	removeAllChannels: vi.fn().mockResolvedValue(undefined),
	resetPushRegistration: vi.fn(),
	setCurrentWorkspace: vi.fn(),
	clearWorkspace: vi.fn(),
	setOwnerUserId: vi.fn(),
}));

const {
	removeAllChannels,
	resetPushRegistration,
	setCurrentWorkspace,
	clearWorkspace,
	setOwnerUserId,
} = mocks;

vi.mock("@/lib/supabase", () => ({
	supabase: {
		removeAllChannels: mocks.removeAllChannels,
		auth: { signOut: vi.fn() },
	},
}));
vi.mock("@/services/pushRegistration", () => ({
	resetPushRegistration: mocks.resetPushRegistration,
}));
vi.mock("@/stores/workspaceStore", () => ({
	useWorkspaceStore: {
		getState: () => ({
			setCurrentWorkspace: mocks.setCurrentWorkspace,
			clear: mocks.clearWorkspace,
		}),
	},
}));
vi.mock("@/stores/appearanceStore", () => ({
	useAppearanceStore: {
		getState: () => ({ setOwnerUserId: mocks.setOwnerUserId }),
	},
}));

import {
	ACCOUNT_DELETED_FLAG,
	tearDownDeletedAccount,
} from "./accountTeardown";

const APPEARANCE_KEY = "proyekto.appearance.v1";
const PUSH_PROMPTED_KEY = "proyekto.push.promptedAt";

const ACCOUNT_KEYS = [
	"ai.threads.v1",
	"roadmap.ai.threads.v1",
	"proyekto-project-settings-storage",
	"prdigy-project-settings-storage",
	"proyekto_guest_session_id",
	"prdigy_guest_session_id",
	"proyekto_guest_user_id",
	"prdigy_guest_user_id",
];

function seedStorage() {
	for (const key of ACCOUNT_KEYS) localStorage.setItem(key, "x");
	localStorage.setItem(APPEARANCE_KEY, '{"theme":"dark"}');
	localStorage.setItem(PUSH_PROMPTED_KEY, "1700000000000");
}

function buildQueryClient() {
	const calls: string[] = [];
	const client = {
		cancelQueries: vi.fn(async () => {
			calls.push("cancel");
		}),
		clear: vi.fn(() => {
			calls.push("clear");
		}),
	};
	return { client, calls };
}

describe("tearDownDeletedAccount", () => {
	beforeEach(() => {
		localStorage.clear();
		sessionStorage.clear();
		vi.clearAllMocks();
	});

	it("clears every key that belongs to the dead account", async () => {
		seedStorage();
		const { client } = buildQueryClient();

		await tearDownDeletedAccount(client as never, "user-1");

		for (const key of ACCOUNT_KEYS) {
			expect(localStorage.getItem(key)).toBeNull();
		}
	});

	it("keeps the theme, and detaches it from the dead account", async () => {
		// Deliberate exception. Clearing it flips the browser from dark to light
		// mid-farewell, which reads as a crash. This test is the only thing
		// stopping a future cleanup "completing" the key list.
		seedStorage();
		const { client } = buildQueryClient();

		await tearDownDeletedAccount(client as never, "user-1");

		expect(localStorage.getItem(APPEARANCE_KEY)).toBe('{"theme":"dark"}');
		expect(setOwnerUserId).toHaveBeenCalledWith(null);
	});

	it("keeps the push-permission marker", async () => {
		// Android 13+ spends its notification prompt once per install, so
		// clearing this would make a different account on this device re-prompt.
		seedStorage();
		const { client } = buildQueryClient();

		await tearDownDeletedAccount(client as never, "user-1");

		expect(localStorage.getItem(PUSH_PROMPTED_KEY)).toBe("1700000000000");
	});

	it("cancels in-flight queries BEFORE clearing the cache", async () => {
		const { client, calls } = buildQueryClient();

		await tearDownDeletedAccount(client as never, "user-1");

		// Reversed, a request that resolves after the clear repopulates the
		// cache with the deleted account's data.
		expect(calls).toEqual(["cancel", "clear"]);
	});

	it("drops realtime channels and the push memo", async () => {
		const { client } = buildQueryClient();

		await tearDownDeletedAccount(client as never, "user-1");

		expect(removeAllChannels).toHaveBeenCalled();
		expect(resetPushRegistration).toHaveBeenCalled();
	});

	it("removes the persisted workspace selection for this user", async () => {
		const { client } = buildQueryClient();

		await tearDownDeletedAccount(client as never, "user-7");

		// setCurrentWorkspace(null, userId) is what actually removes the
		// localStorage key; clear() alone only resets in-memory state.
		expect(setCurrentWorkspace).toHaveBeenCalledWith(null, "user-7");
		expect(clearWorkspace).toHaveBeenCalled();
	});

	it("flags the farewell page", async () => {
		const { client } = buildQueryClient();

		await tearDownDeletedAccount(client as never, "user-1");

		expect(sessionStorage.getItem(ACCOUNT_DELETED_FLAG)).toBe("1");
	});

	it("completes even when storage throws", async () => {
		// Private mode. A half-run teardown is worse than a missed key.
		const spy = vi
			.spyOn(Storage.prototype, "removeItem")
			.mockImplementation(() => {
				throw new Error("storage disabled");
			});
		const { client } = buildQueryClient();

		await expect(
			tearDownDeletedAccount(client as never, "user-1"),
		).resolves.toBeUndefined();
		expect(client.clear).toHaveBeenCalled();

		spy.mockRestore();
	});

	it("completes even when cancelQueries rejects", async () => {
		const client = {
			cancelQueries: vi.fn().mockRejectedValue(new Error("boom")),
			clear: vi.fn(),
		};

		await expect(
			tearDownDeletedAccount(client as never, "user-1"),
		).resolves.toBeUndefined();
		expect(client.clear).toHaveBeenCalled();
	});
});
