import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPage, type LegalSection } from "@/components/legal/LegalPage";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

/**
 * The privacy policy.
 *
 * Every factual claim here is checked against the code, not written from a
 * template: the subprocessor list is the services the backend actually holds
 * credentials for, the mobile telemetry section describes the exact fields the
 * OTA check sends, and the "no tracking" claim is true because no analytics or
 * crash-reporting SDK is installed in `web/` or `backend/` — if one is ever
 * added, this page has to change in the same commit.
 *
 * Reachable without an account, and required to be: both app stores want a
 * privacy-policy URL on the listing, and signup has linked here since before
 * the page existed.
 */
export const Route = createFileRoute("/privacy")({
	component: PrivacyPage,
});

const SECTIONS: LegalSection[] = [
	{
		id: "scope",
		heading: "What this covers",
		body: (
			<>
				<p>
					Proyekto is a work-delivery platform: you plan work as a roadmap, run
					it with your team, and keep the decisions and records around it in one
					place. This policy covers the Proyekto web application at
					proyekto.tech and the Proyekto apps for Android and iOS. They are the
					same product — the apps are the same software in a native shell, using
					the same account and the same data.
				</p>
				<p>
					Proyekto also contains a <strong>marketplace</strong> for finding
					consultants and talent. It is not generally available, it is not part
					of the mobile apps at all, and most accounts will never encounter it.
					Where this policy says something applies only to the marketplace, it
					applies only if you have actively opted into those features.
				</p>
			</>
		),
	},
	{
		id: "what-we-collect",
		heading: "What we collect",
		body: (
			<>
				<p>
					<strong>Your account.</strong> An email address, and either a password
					(stored only as a hash, never in readable form) or a Google account
					identifier if you sign in with Google. Optionally a display name and
					an avatar.
				</p>
				<p>
					<strong>What you create.</strong> The substance of the product:
					workspaces, projects, roadmaps, epics, features and tasks, comments,
					chat messages, meetings, files you upload, and the governance records
					you write — deliverables, change requests, risks and decisions. We
					hold this because storing it and showing it back to you and your
					collaborators is the service.
				</p>
				<p>
					<strong>Activity.</strong> A per-project record of who did what and
					when — a roadmap commit, a task moving, an access change. It exists so
					a team can answer "who changed this". How far back it reaches depends
					on your plan.
				</p>
				<p>
					<strong>Technical records.</strong> Ordinary server logs, and the
					session state needed to keep you signed in.
				</p>
				<p>
					<strong>On mobile, two extra things.</strong> If you turn on push
					notifications, a device push token so we can send them. And when the
					app checks for an update it sends its platform, its app version and a
					generated device identifier — that check is how the app learns whether
					a newer build exists, and the identifier is not linked to your
					account.
				</p>
			</>
		),
	},
	{
		id: "what-we-do-not-do",
		heading: "What we do not do",
		body: (
			<>
				<ul>
					<li>
						<strong>We do not sell your data</strong>, and we do not share it
						with advertisers.
					</li>
					<li>
						<strong>There is no advertising in Proyekto</strong>, and no ad
						network SDK in the apps.
					</li>
					<li>
						<strong>There are no third-party analytics or tracking SDKs</strong>{" "}
						in the web app or the mobile apps. We do not build advertising
						profiles and we do not track you across other apps or websites.
					</li>
					<li>
						We do not use the content you create to train machine-learning
						models.
					</li>
				</ul>
			</>
		),
	},
	{
		id: "ai",
		heading: "The AI assistant",
		body: (
			<>
				<p>
					Proyekto includes an assistant that drafts and edits roadmaps and
					answers questions about your work. When you use it,{" "}
					<strong>
						the content it needs in order to answer is sent to our model
						provider, OpenAI
					</strong>
					, and processed there to generate the reply. That can include the
					roadmap you have open, the items you reference, and the messages in
					that thread.
				</p>
				<p>
					This only happens when you use the assistant. If you never open it,
					nothing is sent. The assistant can only ever read what you yourself
					have access to — it does not cross into projects you cannot open.
				</p>
			</>
		),
	},
	{
		id: "sharing",
		heading: "Who else sees it",
		body: (
			<>
				<p>
					<strong>People you work with.</strong> Proyekto is collaborative
					software, so the people you grant access to a project can see the work
					in it. That is the point of it, and it is under your control: access
					is granted per person, per project.
				</p>
				<p>
					<strong>Service providers.</strong> We use a small number of companies
					to run the product. They process data on our instructions only:
				</p>
				<ul>
					<li>
						<strong>Supabase</strong> — the database and authentication.
					</li>
					<li>
						<strong>Google Cloud</strong> — where the backend and the AI service
						run.
					</li>
					<li>
						<strong>Cloudflare</strong> — serving the web app, and storing files
						you upload.
					</li>
					<li>
						<strong>Upstash</strong> — short-lived caching and session state.
					</li>
					<li>
						<strong>OpenAI</strong> — the model behind the assistant (see
						above).
					</li>
					<li>
						<strong>Firebase Cloud Messaging</strong> — delivering push
						notifications to mobile devices.
					</li>
					<li>
						<strong>Google Workspace</strong> — sending the emails the product
						sends.
					</li>
					<li>
						<strong>Stripe</strong> — payment processing, if your workspace is
						on a paid plan. Card details go to Stripe and are never held by us.
					</li>
				</ul>
				<p>
					<strong>Optional integrations.</strong> If you connect Google
					Calendar, meeting details are sent to Google to create the calendar
					event. That integration is off unless you turn it on.
				</p>
				<p>
					<strong>If the law requires it.</strong> We may disclose data where we
					are legally obliged to.
				</p>
			</>
		),
	},
	{
		id: "retention",
		heading: "How long we keep it",
		body: (
			<>
				<p>
					Your content is kept for as long as your account exists, because it is
					the thing you came to store. Project activity history ages out of a
					window set by your workspace's plan; nothing else is removed with it.
				</p>
				<p>
					Deleting your account is immediate: it happens when you confirm it,
					not on a schedule. Backups persist for a short period afterwards for
					disaster recovery, and then roll off.
				</p>
			</>
		),
	},
	{
		id: "your-choices",
		heading: "Your choices, and deleting your account",
		body: (
			<>
				<p>
					You can edit your profile, change your notification preferences, and
					turn push notifications off from your device settings at any time.
				</p>
				<p>
					<strong>
						To delete your account, go to Settings → Delete account.
					</strong>{" "}
					It is there in the apps as well as on the web. Deletion takes effect
					immediately, there is no waiting period, and there is no way to
					restore an account afterwards. Before you confirm, the screen lists
					exactly what will be deleted, what will be handed to someone else, and
					what will stay.
				</p>
				<p>
					<strong>What deletion removes.</strong> Your profile, your email
					address, your sign-in — password or Google link — your notification
					preferences, your push devices, any API tokens you created, and any
					identity document you uploaded. Any workspace or team you are the only
					member of, and everything in it. Any project nobody else has access
					to.
				</p>
				<p>
					<strong>What it hands over.</strong> A workspace or team you are the
					only owner of, but other people are still using, does not disappear
					underneath them. You decide, one by one: hand it to one of its
					members, or delete it with everything in it. A project you own that
					other people work on is handed to one of those people.
				</p>
				<p>
					<strong>What it keeps, and why.</strong> What you wrote in shared
					spaces stays with the people you wrote it for: chat messages,
					comments, decisions, change requests, deliverables, project activity,
					and files you added to someone else's project or conversation. Your
					name on them becomes "Deleted user", and nothing links them back to
					you — not your email, not your profile. A team's record of how a
					decision was made should not develop holes because one person left.
				</p>
				<p>
					Separately, we are required to keep records of business we have
					transacted. Contracts, invoices and payout records that name you are
					retained for <strong>ten years</strong> from the end of the tax year
					they belong to, because Philippine tax and accounting rules require
					it, and then deleted. They are not used for anything else.
				</p>
				<p>
					When we delete your data we also delete it from the services listed
					above that hold it on our behalf, and ask them to do the same where it
					is not ours to remove directly.
				</p>
				<p>
					You can also ask for a copy of your data, or ask us to correct it.
					Depending on where you live you may have further rights over it; ask
					and we will honour them. If you cannot reach the deletion screen for
					any reason, email{" "}
					<a href="mailto:support@proyekto.tech">support@proyekto.tech</a> from
					the address on the account and we will do it for you.
				</p>
			</>
		),
	},
	{
		id: "security",
		heading: "Security",
		body: (
			<>
				<p>
					Traffic is encrypted in transit. Passwords are stored only as hashes.
					Access to a project is checked on the server on every request — the
					apps never decide for themselves what you are allowed to see, which is
					what stops a client-side mistake becoming a data leak.
				</p>
				<p>
					No system is perfectly secure, and we would rather say so than imply
					otherwise. If you find a vulnerability, please report it to{" "}
					<a href="mailto:support@proyekto.tech">support@proyekto.tech</a>{" "}
					before disclosing it publicly.
				</p>
			</>
		),
	},
	{
		id: "children",
		heading: "Children",
		body: (
			<p>
				Proyekto is a tool for work and is not directed at children. Do not
				create an account if you are under 16. If we learn that an account
				belongs to a child, we will delete it.
			</p>
		),
	},
	{
		id: "international",
		heading: "Where your data is processed",
		body: (
			<p>
				Proyekto is operated from the Philippines, and the services above run in
				data centres in several regions — primarily Singapore, with parts of the
				delivery network distributed globally. Using Proyekto means your data
				may be processed in a country other than your own.
			</p>
		),
	},
	{
		id: "changes",
		heading: "Changes to this policy",
		body: (
			<p>
				If this policy changes in a way that materially affects you, we will
				update the date at the top and tell you in the product before the change
				takes effect. Continuing to use Proyekto after that means the updated
				policy applies.
			</p>
		),
	},
	{
		id: "contact",
		heading: "Contact",
		body: (
			<p>
				Email <a href="mailto:support@proyekto.tech">support@proyekto.tech</a>{" "}
				or use the <Link to="/contact">contact form</Link>. If you are writing
				about a privacy request, say so in the subject so it reaches the right
				person quickly.
			</p>
		),
	},
];

function PrivacyPage() {
	useDocumentTitle("Privacy Policy");
	return (
		<LegalPage
			title="Privacy Policy"
			intro="What Proyekto collects, why, who it goes to, and how to get rid of it. Written to be read rather than to be survived."
			updated="23 September 2026"
			sections={SECTIONS}
		/>
	);
}
