// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const capacitor = vi.hoisted(() => ({
	isNativePlatform: vi.fn(() => true),
	isPluginAvailable: vi.fn(() => true),
}));
// Loosely typed on purpose: these stand in for native/SDK surfaces whose real
// shapes are unions, and pinning them here buys nothing but casts at every call.
type AnyFn = (...args: any[]) => any;
const socialLogin = vi.hoisted(() => ({
	initialize: vi.fn<AnyFn>(),
	login: vi.fn<AnyFn>(),
}));
const auth = vi.hoisted(() => ({
	signInWithIdToken: vi.fn<AnyFn>(),
}));

vi.mock("@capacitor/core", () => ({ Capacitor: capacitor }));
vi.mock("@capgo/capacitor-social-login", () => ({ SocialLogin: socialLogin }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth } }));

const googleToken = {
	provider: "google" as const,
	result: { idToken: "id-token-abc" },
};

/** Re-import per test: the module memoises initialize() at module scope. */
async function load() {
	vi.resetModules();
	return await import("./googleAuth");
}

describe("googleAuth", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		socialLogin.initialize.mockResolvedValue(undefined);
		vi.stubEnv(
			"VITE_GOOGLE_WEB_CLIENT_ID",
			"web-client-id.apps.googleusercontent.com",
		);
		capacitor.isNativePlatform.mockReturnValue(true);
		capacitor.isPluginAvailable.mockReturnValue(true);
		socialLogin.login.mockResolvedValue(googleToken);
		auth.signInWithIdToken.mockResolvedValue({ data: {}, error: null });
	});

	describe("isNativeGoogleAuthAvailable", () => {
		it("is true in the app with a client id configured", async () => {
			const { isNativeGoogleAuthAvailable } = await load();
			expect(isNativeGoogleAuthAvailable()).toBe(true);
		});

		it("is false on the web, so the browser keeps the redirect flow", async () => {
			capacitor.isNativePlatform.mockReturnValue(false);
			const { isNativeGoogleAuthAvailable } = await load();
			expect(isNativeGoogleAuthAvailable()).toBe(false);
		});

		// A native build shipped without the id must fall back rather than
		// present a button that cannot possibly work.
		it("is false when the client id is missing", async () => {
			vi.stubEnv("VITE_GOOGLE_WEB_CLIENT_ID", "");
			const { isNativeGoogleAuthAvailable } = await load();
			expect(isNativeGoogleAuthAvailable()).toBe(false);
		});

		it("is false when the native plugin is not in the build", async () => {
			capacitor.isPluginAvailable.mockReturnValue(false);
			const { isNativeGoogleAuthAvailable } = await load();
			expect(isNativeGoogleAuthAvailable()).toBe(false);
		});
	});

	describe("signInWithGoogleNative", () => {
		it("trades the Google id token for a Supabase session", async () => {
			const { signInWithGoogleNative } = await load();

			await expect(signInWithGoogleNative()).resolves.toEqual({ ok: true });

			expect(socialLogin.initialize).toHaveBeenCalledWith({
				google: { webClientId: "web-client-id.apps.googleusercontent.com" },
			});
			expect(auth.signInWithIdToken).toHaveBeenCalledWith(
				expect.objectContaining({ provider: "google", token: "id-token-abc" }),
			);
		});

		// The one detail that silently breaks the whole flow: Google echoes the
		// nonce it is handed into the token claim, and Supabase compares the
		// SHA-256 of what it is given against that claim. Same string to both =
		// rejected token.
		it("sends the hashed nonce to Google and the raw one to Supabase", async () => {
			const { signInWithGoogleNative } = await load();
			await signInWithGoogleNative();

			const sent = socialLogin.login.mock.calls[0][0].options.nonce as string;
			const raw = auth.signInWithIdToken.mock.calls[0][0].nonce as string;

			expect(raw).not.toBe(sent);
			expect(sent).toMatch(/^[0-9a-f]{64}$/);

			const digest = await crypto.subtle.digest(
				"SHA-256",
				new TextEncoder().encode(raw),
			);
			const expected = Array.from(new Uint8Array(digest), (b) =>
				b.toString(16).padStart(2, "0"),
			).join("");
			expect(sent).toBe(expected);
		});

		// Regression: passing any scopes array makes the Android provider reject the
		// call outright ("You CANNOT use scopes without modifying the main activity"),
		// and it grants openid/email/profile by default anyway.
		it("asks for no scopes", async () => {
			const { signInWithGoogleNative } = await load();
			await signInWithGoogleNative();

			expect(socialLogin.login.mock.calls[0][0].options).not.toHaveProperty(
				"scopes",
			);
		});

		it("uses a fresh nonce per attempt", async () => {
			const { signInWithGoogleNative } = await load();
			await signInWithGoogleNative();
			await signInWithGoogleNative();

			expect(socialLogin.login.mock.calls[0][0].options.nonce).not.toBe(
				socialLogin.login.mock.calls[1][0].options.nonce,
			);
		});

		it("reports a dismissed account sheet as a cancellation, not an error", async () => {
			socialLogin.login.mockRejectedValue(
				new Error("The user canceled the sign-in flow"),
			);
			const { signInWithGoogleNative } = await load();

			await expect(signInWithGoogleNative()).resolves.toEqual({
				ok: false,
				cancelled: true,
			});
		});

		it("surfaces a Supabase rejection verbatim", async () => {
			auth.signInWithIdToken.mockResolvedValue({
				data: {},
				error: { message: "Passed nonce and nonce in id_token should match" },
			});
			const { signInWithGoogleNative } = await load();

			await expect(signInWithGoogleNative()).resolves.toEqual({
				ok: false,
				cancelled: false,
				error: "Passed nonce and nonce in id_token should match",
			});
		});

		it("fails cleanly when Google returns no id token", async () => {
			socialLogin.login.mockResolvedValue({
				provider: "google",
				result: { idToken: null },
			});
			const { signInWithGoogleNative } = await load();

			const result = await signInWithGoogleNative();
			expect(result.ok).toBe(false);
			expect(auth.signInWithIdToken).not.toHaveBeenCalled();
		});

		// A failed initialize must not be cached, or the button is dead for the
		// rest of the session.
		it("retries initialization after a failure", async () => {
			socialLogin.initialize.mockRejectedValueOnce(
				new Error("no play services"),
			);
			const { signInWithGoogleNative } = await load();

			const first = await signInWithGoogleNative();
			expect(first.ok).toBe(false);

			await expect(signInWithGoogleNative()).resolves.toEqual({ ok: true });
			expect(socialLogin.initialize).toHaveBeenCalledTimes(2);
		});

		it("never throws", async () => {
			socialLogin.login.mockRejectedValue("a bare string, not an Error");
			const { signInWithGoogleNative } = await load();

			await expect(signInWithGoogleNative()).resolves.toMatchObject({
				ok: false,
			});
		});
	});
});
