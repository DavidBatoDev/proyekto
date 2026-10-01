// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const capacitor = vi.hoisted(() => ({
	isNativePlatform: vi.fn(() => true),
	isPluginAvailable: vi.fn(() => true),
	getPlatform: vi.fn(() => "ios"),
}));
type AnyFn = (...args: any[]) => any;
const socialLogin = vi.hoisted(() => ({
	initialize: vi.fn<AnyFn>(),
	login: vi.fn<AnyFn>(),
}));
const auth = vi.hoisted(() => ({
	signInWithIdToken: vi.fn<AnyFn>(),
	updateUser: vi.fn<AnyFn>(),
}));

vi.mock("@capacitor/core", () => ({ Capacitor: capacitor }));
vi.mock("@capgo/capacitor-social-login", () => ({ SocialLogin: socialLogin }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth } }));

const appleResponse = (profile: {
	givenName: string | null;
	familyName: string | null;
}) => ({
	provider: "apple" as const,
	result: {
		idToken: "apple-id-token",
		accessToken: null,
		profile: {
			user: "001.abc",
			email: "a@privaterelay.appleid.com",
			...profile,
		},
	},
});

/** Re-import per test: initialize() is memoised at module scope. */
async function load() {
	vi.resetModules();
	return await import("./appleAuth");
}

describe("appleAuth", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		capacitor.isNativePlatform.mockReturnValue(true);
		capacitor.isPluginAvailable.mockReturnValue(true);
		capacitor.getPlatform.mockReturnValue("ios");
		socialLogin.initialize.mockResolvedValue(undefined);
		socialLogin.login.mockResolvedValue(
			appleResponse({ givenName: "Alex", familyName: "Morgan" }),
		);
		auth.signInWithIdToken.mockResolvedValue({ data: {}, error: null });
		auth.updateUser.mockResolvedValue({ data: {}, error: null });
	});

	describe("isNativeAppleAuthAvailable", () => {
		it("is true in the iOS app", async () => {
			const { isNativeAppleAuthAvailable } = await load();
			expect(isNativeAppleAuthAvailable()).toBe(true);
		});

		it("is false on Android and the web — guideline 4.8 is iOS-only", async () => {
			const { isNativeAppleAuthAvailable } = await load();
			capacitor.getPlatform.mockReturnValue("android");
			expect(isNativeAppleAuthAvailable()).toBe(false);
			capacitor.getPlatform.mockReturnValue("web");
			expect(isNativeAppleAuthAvailable()).toBe(false);
		});
	});

	describe("signInWithAppleNative", () => {
		it("initializes the Apple provider for the native sheet on iOS", async () => {
			const { signInWithAppleNative } = await load();
			await signInWithAppleNative();
			expect(socialLogin.initialize.mock.calls[0][0]).toMatchObject({
				apple: { redirectUrl: "" },
			});
		});

		it("gives Apple the hashed nonce and Supabase the raw one", async () => {
			const { signInWithAppleNative } = await load();
			const result = await signInWithAppleNative();

			expect(result).toEqual({ ok: true });
			const sent = socialLogin.login.mock.calls[0][0];
			expect(sent.provider).toBe("apple");
			const rawNonce = auth.signInWithIdToken.mock.calls[0][0].nonce;
			expect(auth.signInWithIdToken.mock.calls[0][0]).toMatchObject({
				provider: "apple",
				token: "apple-id-token",
			});
			const digest = await crypto.subtle.digest(
				"SHA-256",
				new TextEncoder().encode(rawNonce),
			);
			const hex = Array.from(new Uint8Array(digest), (b) =>
				b.toString(16).padStart(2, "0"),
			).join("");
			expect(sent.options.nonce).toBe(hex);
			expect(sent.options.nonce).not.toBe(rawNonce);
		});

		it("saves the first-sign-in name to user metadata", async () => {
			const { signInWithAppleNative } = await load();
			await signInWithAppleNative();
			expect(auth.updateUser).toHaveBeenCalledWith({
				data: {
					given_name: "Alex",
					family_name: "Morgan",
					full_name: "Alex Morgan",
				},
			});
		});

		it("does not wipe the name on later sign-ins, when Apple sends none", async () => {
			socialLogin.login.mockResolvedValue(
				appleResponse({ givenName: null, familyName: null }),
			);
			const { signInWithAppleNative } = await load();
			await signInWithAppleNative();
			expect(auth.updateUser).not.toHaveBeenCalled();
		});

		it("treats closing the sheet as a cancel, not an error", async () => {
			socialLogin.login.mockRejectedValue(
				new Error(
					"The operation couldn't be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)",
				),
			);
			const { signInWithAppleNative } = await load();
			expect(await signInWithAppleNative()).toEqual({
				ok: false,
				cancelled: true,
			});
		});

		it("surfaces a Supabase rejection", async () => {
			auth.signInWithIdToken.mockResolvedValue({
				data: {},
				error: { message: "Provider apple is not enabled" },
			});
			const { signInWithAppleNative } = await load();
			expect(await signInWithAppleNative()).toEqual({
				ok: false,
				cancelled: false,
				error: "Provider apple is not enabled",
			});
		});

		it("reports a missing identity token", async () => {
			socialLogin.login.mockResolvedValue({
				provider: "apple",
				result: { idToken: null, accessToken: null, profile: null },
			});
			const { signInWithAppleNative } = await load();
			const result = await signInWithAppleNative();
			expect(result).toMatchObject({ ok: false, cancelled: false });
		});
	});
});
