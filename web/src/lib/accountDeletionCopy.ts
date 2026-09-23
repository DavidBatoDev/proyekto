import type { CopySurface } from "./usageCopy";

/**
 * Every sentence the delete-account flow says.
 *
 * In one module for two reasons. First, this is a high-stakes irreversible
 * action and the copy IS the design — it is worth reading as a whole rather
 * than scattered across six components. Second, it ships inside the free mobile
 * app, so it is subject to the same rule as `usageCopy.ts`: **no price, no
 * plan-change call to action, no link to /pricing on native**. A test enforces
 * that, and keeping the strings here is what makes the test possible.
 */

export const CONFIRMATION_PHRASE = "delete my account";

/** Forgiving on case and stray spaces; nothing else counts. */
export function matchesConfirmationPhrase(value: string): boolean {
	return value.trim().toLowerCase() === CONFIRMATION_PHRASE;
}

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

export const deletionCopy = {
	entryHeading: "Delete account",
	entryBody:
		"Permanently delete your Proyekto account and the work only you can see. This cannot be undone.",
	entryCta: "Delete account",

	reviewTitle: "Delete your account",
	reviewIntro:
		"This is permanent. There is no grace period, no pending state, and no way to restore an account afterwards. Read what happens first.",

	deletedHeading: "What gets deleted",
	transferHeading: "What moves to someone else",
	keptHeading: "What stays, as “Deleted user”",
	decisionsHeading: "What needs a decision from you",

	/**
	 * Bullets are omitted entirely at zero rather than rendered as "0 projects",
	 * which reads like a bug and makes the list longer than the truth.
	 */
	deletedBullets(counts: {
		workspaces: number;
		teams: number;
		projects: number;
		roadmaps: number;
		devices: number;
		apiTokens: number;
	}): string[] {
		const out: string[] = [
			"Your profile, your email address and your sign-in.",
		];
		if (counts.workspaces > 0) {
			out.push(
				`${plural(counts.workspaces, "workspace", "workspaces")} nobody else is in, and everything inside.`,
			);
		}
		if (counts.teams > 0) {
			out.push(`${plural(counts.teams, "team", "teams")} nobody else is in.`);
		}
		if (counts.projects > 0) {
			out.push(
				`${plural(counts.projects, "project", "projects")} nobody else has access to.`,
			);
		}
		if (counts.roadmaps > 0) {
			out.push(
				`${plural(counts.roadmaps, "roadmap", "roadmaps")} that are not attached to a project.`,
			);
		}
		if (counts.devices > 0) {
			out.push(
				`Push notifications on ${plural(counts.devices, "device", "devices")}.`,
			);
		}
		if (counts.apiTokens > 0) {
			out.push(
				`${plural(counts.apiTokens, "API token", "API tokens")} you created.`,
			);
		}
		out.push("Your AI threads and unsent drafts.");
		return out;
	},

	transferBody(projects: number): string {
		if (projects === 0) {
			return "Nothing. You do not own a project that anyone else can open.";
		}
		return `${plural(projects, "project", "projects")} you own are shared with other people. Each one is handed to someone who already works on it, so nobody loses access and nothing is asked of you here.`;
	},

	keptIntro:
		"Work in a shared project belongs to the team, not only to you. This stays exactly where it is, and your name on it becomes “Deleted user” — your email address and your profile do not stay with it:",

	keptBullets(counts: {
		chatMessages: number;
		comments: number;
		decisions: number;
		deliverables: number;
		changeRequests: number;
		risks: number;
		activityEntries: number;
		contracts: number;
		invoices: number;
		payouts: number;
	}): string[] {
		const out: string[] = [];
		if (counts.chatMessages > 0) {
			out.push(
				`${plural(counts.chatMessages, "message", "messages")} you sent in project chats.`,
			);
		}
		if (counts.comments > 0) {
			out.push(
				`${plural(counts.comments, "comment", "comments")} on tasks, epics and features.`,
			);
		}
		const governance =
			counts.decisions +
			counts.deliverables +
			counts.changeRequests +
			counts.risks;
		if (governance > 0) {
			out.push(
				"Decisions, deliverables, change requests and risks you recorded.",
			);
		}
		if (counts.activityEntries > 0) {
			out.push("Your entries in project activity history.");
		}
		const financial = counts.contracts + counts.invoices + counts.payouts;
		if (financial > 0) {
			out.push(
				"Contracts, invoices and payout records naming you, which we are required to keep.",
			);
		}
		out.push(
			"Files you added to someone else’s project, task or conversation.",
		);
		return out;
	},

	keptReason:
		"A team’s record of how something was decided should not grow holes because one person left.",

	decisionsIntro(count: number): string {
		return `You are the only owner of ${plural(count, "workspace or team", "workspaces and teams")} that other people are still using. Each one needs a new owner, or it needs to go.`;
	},

	successorWarning(name: string): string {
		return `${name} gets full ownership. They are not asked first, and they cannot refuse.`;
	},

	deleteContainerWarning(name: string, members: number): string {
		return `Everything in ${name} goes, and its ${plural(members - 1, "other member", "other members")} lose access.`;
	},

	cannotDeleteReason:
		"This one has records that have to be kept, so it has to be handed to someone rather than deleted.",

	/**
	 * Billing. This is the sentence the whole surface-aware apparatus exists
	 * for: on native it names no price, links nowhere, and offers no way to
	 * change a plan — an outbound link from here is exactly the purchase-steering
	 * a store reviewer looks for.
	 */
	billingNote(
		name: string,
		surface: CopySurface,
	): { text: string; link: { to: string; label: string } | null } {
		if (surface === "app") {
			return {
				text: `${name} is on a paid plan. Deleting your account hands the plan on with the workspace, or cancels it if the workspace goes. Plans are managed on the web.`,
				link: null,
			};
		}
		return {
			text: `${name} is on a paid plan. Handing the workspace on hands the plan on with it; deleting the workspace cancels the plan immediately.`,
			link: { to: "/pricing", label: "See plans" },
		};
	},

	lastAdminWarning:
		"You are the only platform administrator. Deleting your account leaves the admin console with nobody able to open it.",

	confirmTitle: "Confirm",
	confirmIntro: "Last screen. Nothing has changed yet.",
	confirmPhraseLabel: `Type “${CONFIRMATION_PHRASE}” to confirm`,
	confirmPasswordLabel: "Enter your password",
	confirmPasswordHint: "We ask again because this cannot be undone.",
	confirmCodeLabel: "Enter the code we emailed you",
	confirmCodeHint:
		"Signing in with Google does not give us a password to check, so we send a code instead.",
	confirmFinalWarning:
		"There is no undo. You will be signed out on every device, and signing up again with the same email gives you a brand-new, empty account.",
	confirmCta: "Delete my account",

	disabledBecausePhrase: "Type the phrase above to enable this.",
	disabledBecauseCredential: "Enter your password to enable this.",
	disabledBecauseCode: "Enter the emailed code to enable this.",
	disabledBecauseUndecided(remaining: number): string {
		return `${plural(remaining, "workspace or team", "workspaces and teams")} still need a decision.`;
	},

	runningTitle: "Deleting your account",
	runningBody(surface: CopySurface): string {
		return surface === "app"
			? "This takes a few seconds. Please do not close the app."
			: "This takes a few seconds. Please do not close this tab.";
	},
	runningSlow: "Still working. Large workspaces take longer.",

	lostConnectionTitle: "We lost the connection while deleting your account",
	lostConnectionBody:
		"We do not know yet whether it finished. Nothing else will happen until you check.",
	lostConnectionCta: "Check status",
	lostConnectionStillOffline:
		"Still no connection. Check again when you are back online.",
	stillHere: "Your account is still here. Here is where things stand now.",

	/** `accountIntact: true` — the transaction rolled back, so retrying is safe. */
	failedIntact:
		"Nothing was deleted. Something went wrong before we changed anything, so your account and everything in it are exactly as they were.",
	/** `accountIntact: false` — the identity is gone, cleanup is still running. */
	failedPartial:
		"Some cleanup is still finishing in the background. Your account and your sign-in are already gone.",

	goodbyeTitle: "Your Proyekto account is deleted.",
	goodbyeBody:
		"Your profile and your sign-in are gone, and you have been signed out everywhere.",
	goodbyeKept:
		"What you wrote in shared projects stays with your team, attributed to “Deleted user”. Signing up again with the same email gives you a brand-new, empty account — nothing from this one comes back.",
} as const;
