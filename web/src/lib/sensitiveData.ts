import { isNativeApp } from "@/lib/platform";

/**
 * Whether this surface may collect or show payout details (bank, GCash,
 * PayPal account numbers) and identity documents.
 *
 * Web only. The installed app never asks for them and never displays them, so
 * its Play Data safety / App Privacy declarations stay free of the financial
 * and government-ID categories — the same reasoning that keeps the
 * marketplace and every commerce surface out of the app
 * (see lib/platformSurfaces.ts). Recording a payout still works in the app;
 * it just goes without the member's stored payout details.
 */
export function canHandleSensitiveData(): boolean {
	return !isNativeApp();
}
