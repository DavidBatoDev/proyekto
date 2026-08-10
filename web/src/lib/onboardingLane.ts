export type AccountRole = "client" | "talent" | "consultant";
export type OnboardingLane = AccountRole | "client_freelancer";
export type LegacyOnboardingIntent =
	| "client"
	| "freelancer"
	| { client?: boolean; freelancer?: boolean }
	| null
	| undefined;

export interface LegacyOnboardingIntentPayload {
	client: boolean;
	freelancer: boolean;
}

export type CompleteOnboardingPayload =
	| { lane: AccountRole }
	| {
			lane: "client_freelancer";
			intent: LegacyOnboardingIntentPayload;
	  };

export function mapLegacyLane(
	lane: OnboardingLane,
	intent?: LegacyOnboardingIntent,
): AccountRole {
	if (lane !== "client_freelancer") return lane;
	if (intent === "freelancer") return "talent";
	if (intent === "client") return "client";
	if (intent == null) return "client";
	return intent.client === true && intent.freelancer !== true
		? "client"
		: "talent";
}

function legacyIntentPayload(
	legacyIntent: LegacyOnboardingIntent,
	defaultRole: "client" | "talent",
): LegacyOnboardingIntentPayload {
	const role =
		legacyIntent == null
			? defaultRole
			: mapLegacyLane("client_freelancer", legacyIntent);
	if (role === "client") return { client: true, freelancer: false };
	return { client: false, freelancer: true };
}

export function normalizeSignupLane(
	lane: OnboardingLane,
	legacyIntent: LegacyOnboardingIntent,
): AccountRole {
	return mapLegacyLane(lane, legacyIntent);
}

export function buildOnboardingPayload(
	lane: OnboardingLane,
	legacyIntent?: LegacyOnboardingIntent,
): CompleteOnboardingPayload {
	if (lane !== "client_freelancer") return { lane };

	return {
		lane,
		intent: legacyIntentPayload(legacyIntent, "client"),
	};
}
