/**
 * Opt-in channel presets shown in the Create channel modal. These used to be
 * auto-provisioned per project (the backend `PROJECT_SYSTEM_ROOMS`), but new
 * projects now start with just #general — teams create the channels they actually
 * need from here. Picking one pre-fills the create form; the resulting channel is
 * an ordinary user channel (slug derived from the name).
 *
 * The presets used to be persona rooms — "Client Project Room", "Consultant &
 * Client", "Consultant & PM" — and the first of them auto-added whoever resolved
 * to the consultant or client persona. A project is the execution layer: it has
 * members with permissions, not a client and a consultant, so a preset can suggest
 * a shape but never a membership. Whoever creates the channel adds the people.
 *
 * `slug` is the canonical slug these provision with, kept so an already-created
 * suggestion can be deduped out of the list.
 */
export interface ChannelSuggestion {
	slug: string;
	name: string;
	isPrivate: boolean;
	description: string;
}

export const CHANNEL_SUGGESTIONS: ChannelSuggestion[] = [
	{
		slug: "internal-team",
		name: "Internal Team",
		isPrivate: true,
		description: "Private space for the people delivering the work.",
	},
	{
		// Kept under its original slug so an existing room dedupes correctly on
		// projects that were auto-provisioned before presets existed.
		slug: "client-room",
		name: "Stakeholders",
		isPrivate: true,
		description:
			"Private space for the people commissioning the work and whoever leads it. Add members explicitly.",
	},
	{
		slug: "announcements",
		name: "Announcements",
		isPrivate: false,
		description: "Open channel for updates everyone on the project should see.",
	},
];
