/**
 * Opt-in channel presets shown in the Create channel modal. These used to be
 * auto-provisioned per project (the backend `PROJECT_SYSTEM_ROOMS`), but new
 * projects now start with just #general — teams create the persona rooms they
 * actually need from here. Picking one pre-fills the create form; the resulting
 * channel is an ordinary user channel (slug derived from the name).
 *
 * `slug` is the canonical slug these used to provision with — kept only so we
 * can dedupe a suggestion that's already been created.
 */
export interface ChannelSuggestion {
	slug: string;
	name: string;
	isPrivate: boolean;
	description: string;
	defaultAudience?: "client_core";
}

export const CHANNEL_SUGGESTIONS: ChannelSuggestion[] = [
	{
		slug: "client-room",
		name: "Client Project Room",
		isPrivate: true,
		defaultAudience: "client_core",
		description:
			"Private space for the consultant, project owner, and client. Managers can add selected teammates.",
	},
	{
		slug: "internal-team",
		name: "Internal Team",
		isPrivate: true,
		description: "Private space for your internal team only.",
	},
	{
		slug: "consultant-client",
		name: "Consultant & Client",
		isPrivate: true,
		description: "Private room for the consultant and the client.",
	},
	{
		slug: "consultant-pm",
		name: "Consultant & PM",
		isPrivate: true,
		description: "Private room for the consultant and the project manager.",
	},
];
