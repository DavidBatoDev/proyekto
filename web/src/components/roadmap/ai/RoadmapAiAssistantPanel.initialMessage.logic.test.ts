import { describe, expect, it } from "vitest";
import { shouldAutoSendInitialMessage } from "./RoadmapAiAssistantPanel";

const readyState = {
	isVisible: true,
	initialMessage: "Build me a roadmap for a booking app",
	isSending: false,
	threadsListReady: true,
	hasAutoSentInitial: false,
};

describe("hero initial-message auto-send gating", () => {
	it("fires when visible with a pending message, sessions loaded, and idle", () => {
		expect(shouldAutoSendInitialMessage(readyState)).toBe(true);
	});

	it("stays quiet without a usable message", () => {
		expect(
			shouldAutoSendInitialMessage({ ...readyState, initialMessage: null }),
		).toBe(false);
		expect(
			shouldAutoSendInitialMessage({
				...readyState,
				initialMessage: undefined,
			}),
		).toBe(false);
		expect(
			shouldAutoSendInitialMessage({ ...readyState, initialMessage: "   " }),
		).toBe(false);
	});

	it("waits for panel visibility and the sessions list", () => {
		expect(
			shouldAutoSendInitialMessage({ ...readyState, isVisible: false }),
		).toBe(false);
		expect(
			shouldAutoSendInitialMessage({ ...readyState, threadsListReady: false }),
		).toBe(false);
	});

	it("respects an in-flight send", () => {
		expect(
			shouldAutoSendInitialMessage({ ...readyState, isSending: true }),
		).toBe(false);
	});

	it("latches after the first dispatch", () => {
		expect(
			shouldAutoSendInitialMessage({ ...readyState, hasAutoSentInitial: true }),
		).toBe(false);
	});

	it("fires exactly once across a realistic render sequence", () => {
		// Replays the panel effect across renders: the ref latch flips on the
		// first fire and the parent consume callback clears the message.
		let hasAutoSentInitial = false;
		let initialMessage: string | null = readyState.initialMessage;
		let fires = 0;

		const renderStates = [
			{ isVisible: true, isSending: false, threadsListReady: false }, // mount, list pending
			{ isVisible: true, isSending: false, threadsListReady: true }, // list resolves -> fire
			{ isVisible: true, isSending: true, threadsListReady: true }, // send in flight
			{ isVisible: true, isSending: false, threadsListReady: true }, // send settles
		];

		for (const state of renderStates) {
			if (
				shouldAutoSendInitialMessage({
					...state,
					initialMessage,
					hasAutoSentInitial,
				})
			) {
				hasAutoSentInitial = true;
				fires += 1;
				initialMessage = null; // onInitialMessageConsumed
			}
		}

		expect(fires).toBe(1);
	});

	it("fires exactly once even if the parent never clears the message", () => {
		// The ref latch alone must prevent a second dispatch (e.g. if the consume
		// callback is omitted by a caller).
		let hasAutoSentInitial = false;
		let fires = 0;

		for (const isSending of [false, true, false, false]) {
			if (
				shouldAutoSendInitialMessage({
					isVisible: true,
					initialMessage: readyState.initialMessage,
					isSending,
					threadsListReady: true,
					hasAutoSentInitial,
				})
			) {
				hasAutoSentInitial = true;
				fires += 1;
			}
		}

		expect(fires).toBe(1);
	});
});
