/**
 * Video-conferencing provider identity. We keep the backend storing only
 * none/jitsi/external_link, and *derive* the brand of a pasted link from its URL
 * host purely for display (logo + label) — no enum change needed.
 */
export type ProviderId = "jitsi" | "google_meet" | "zoom" | "teams" | "other";

export const PROVIDER_LABELS: Record<ProviderId, string> = {
	jitsi: "Jitsi Meet",
	google_meet: "Google Meet",
	zoom: "Zoom",
	teams: "Microsoft Teams",
	other: "Video link",
};

/** Map a meeting URL to its provider brand by hostname. */
export function detectProvider(url: string | null | undefined): ProviderId {
	if (!url) return "other";
	let host: string;
	try {
		host = new URL(url).hostname.toLowerCase();
	} catch {
		host = url.toLowerCase();
	}
	if (host.includes("meet.google.com") || host.includes("meet.google"))
		return "google_meet";
	if (host.includes("zoom.us") || host.includes("zoom.com")) return "zoom";
	if (host.includes("teams.microsoft.com") || host.includes("teams.live.com"))
		return "teams";
	if (host.includes("jit.si") || host.includes("jitsi")) return "jitsi";
	return "other";
}
