import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPage, type LegalSection } from "@/components/legal/LegalPage";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

/**
 * The terms of service.
 *
 * Scoped deliberately to the SaaS. The marketplace exists in the codebase but
 * is not launched, so it is described as unavailable rather than governed by
 * clauses about payments and engagements that nobody can yet enter into —
 * terms that promise a service you do not operate are worse than terms that
 * admit it is not ready.
 *
 * The billing section says plans are bought on the web, which is not a
 * throwaway line: the mobile apps carry no purchase surface at all, and this
 * page is part of what a store reviewer reads.
 */
export const Route = createFileRoute("/terms")({
	component: TermsPage,
});

const SECTIONS: LegalSection[] = [
	{
		id: "agreement",
		heading: "This agreement",
		body: (
			<>
				<p>
					These terms are the agreement between you and Proyekto for use of the
					Proyekto web application at proyekto.tech and the Proyekto apps for
					Android and iOS. By creating an account or using Proyekto, you accept
					them.
				</p>
				<p>
					If you are accepting on behalf of a company, you are confirming you
					have the authority to bind it, and "you" means that company.
				</p>
			</>
		),
	},
	{
		id: "service",
		heading: "What Proyekto is",
		body: (
			<>
				<p>
					Proyekto is software for planning and delivering work. A workspace
					holds your projects and your team; a project holds a roadmap, the
					people working on it, chat, meetings, files and a set of governance
					records. An AI assistant can draft and edit roadmaps for you.
				</p>
				<p>
					<strong>
						Proyekto also contains a marketplace for finding consultants and
						talent. It is not generally available.
					</strong>{" "}
					It is not in the mobile apps, and the parts of it that exist are not
					offered as a live service. Nothing in these terms should be read as a
					promise to operate a marketplace, to introduce you to anyone, to vet
					anyone, or to be involved in an agreement between you and another
					party. If and when those features launch, we will publish terms that
					cover them properly and tell you before they apply to you.
				</p>
				<p>
					<strong>Proyekto does not take, hold or transfer money</strong>{" "}
					between you and anyone else. Where the product records an invoice or a
					payout, it is recording something that happened elsewhere; it is a
					record, not a payment service.
				</p>
			</>
		),
	},
	{
		id: "accounts",
		heading: "Your account",
		body: (
			<>
				<p>
					You need an account to use Proyekto, you must be at least 16, and the
					details you give us must be accurate. You are responsible for what
					happens under your account and for keeping your credentials safe. Tell
					us promptly if you think someone else has access to it.
				</p>
				<p>
					Access inside a project is granted person by person. If you invite
					someone, you are the one deciding what they can see.
				</p>
			</>
		),
	},
	{
		id: "your-content",
		heading: "Your content",
		body: (
			<>
				<p>
					<strong>You own what you create in Proyekto.</strong> We claim no
					ownership of your roadmaps, tasks, messages, files or records.
				</p>
				<p>
					You give us the permission we need to actually run the service — to
					store your content, transmit it, back it up, and show it to the people
					you have granted access. That permission exists for operating Proyekto
					and nothing else. It ends when you delete the content, or when you
					delete your account — with one exception: content you posted into a
					shared space stays with the people you shared it with, attributed to
					"Deleted user", so their records stay intact.
				</p>
				<p>
					You are responsible for the content you put in, including having the
					right to put it there.
				</p>
			</>
		),
	},
	{
		id: "plans",
		heading: "Plans and billing",
		body: (
			<>
				<p>
					Proyekto has a free plan and paid plans. A plan belongs to a
					workspace, not to a person, and paid plans are billed per member of
					that workspace. Current prices are published on the Proyekto website.
				</p>
				<p>
					<strong>
						Plans are purchased and managed on the web, at proyekto.tech.
					</strong>{" "}
					The mobile apps do not sell anything. Payment is handled by our
					payment processor; we never hold your card details.
				</p>
				<p>
					<strong>Limits never take anything away.</strong> Reaching a plan
					limit stops you adding more of that one thing — another project,
					another member. Everything you already have stays exactly as it is,
					readable and editable. The same is true if you move to a smaller plan:
					features that plan does not include stop being reachable, and the data
					behind them is not deleted.
				</p>
				<p>
					You can change or cancel a plan at any time. Changing plan is
					prorated. We do not generally give refunds for time already elapsed,
					but if something has gone wrong, write to us — we would rather fix it
					than argue about it.
				</p>
			</>
		),
	},
	{
		id: "ai",
		heading: "The AI assistant",
		body: (
			<>
				<p>
					The assistant drafts and edits work on your instruction. Two things
					follow from that, and both matter:
				</p>
				<ul>
					<li>
						<strong>It can be wrong.</strong> Output is generated, not verified.
						Review it before you rely on it, and do not treat it as professional
						advice.
					</li>
					<li>
						<strong>You decide what lands.</strong> Structural changes are shown
						to you as a diff and only applied when you approve them. What you
						commit is your responsibility.
					</li>
				</ul>
				<p>
					Using the assistant sends the content it needs to our model provider —
					see the <Link to="/privacy">Privacy Policy</Link>. Your plan may
					include a monthly allowance of assistant messages.
				</p>
			</>
		),
	},
	{
		id: "acceptable-use",
		heading: "Acceptable use",
		body: (
			<>
				<p>Do not use Proyekto to:</p>
				<ul>
					<li>break the law, or infringe someone else's rights;</li>
					<li>
						upload malware, or attempt to breach, probe or overload the service;
					</li>
					<li>
						access data you have not been granted access to, or try to work
						around the permission system;
					</li>
					<li>
						harass or abuse other people, or send unsolicited bulk messages;
					</li>
					<li>
						resell or redistribute Proyekto as your own product, or scrape it at
						scale.
					</li>
				</ul>
			</>
		),
	},
	{
		id: "availability",
		heading: "Availability and changes",
		body: (
			<>
				<p>
					We work to keep Proyekto available and we ship changes to it
					continuously — including to the mobile apps, which update themselves
					without going through an app store. We do not promise uninterrupted
					service, and we may need to take it down for maintenance.
				</p>
				<p>
					If we ever discontinue a material feature you depend on, we will give
					you reasonable notice and a way to get your data out.
				</p>
			</>
		),
	},
	{
		id: "termination",
		heading: "Ending it",
		body: (
			<>
				<p>
					You can stop using Proyekto and delete your account at any time, from{" "}
					<strong>Settings → Delete account</strong> — in the apps as well as on
					the web. Deletion is immediate and permanent. The{" "}
					<Link to="/privacy">Privacy Policy</Link> sets out exactly what is
					deleted, what is handed to other people, and what stays.
				</p>
				<p>
					If you are the only owner of a workspace or team other people are
					still using, deleting your account asks you to hand it to one of its
					members or to delete it. Whoever you choose inherits it, including any
					plan attached to it.
				</p>
				<p>
					We may suspend or close an account that breaks these terms, or that
					puts the service or other users at risk. Except where something is
					seriously or repeatedly wrong, we will tell you first and give you a
					chance to put it right.
				</p>
			</>
		),
	},
	{
		id: "disclaimers",
		heading: "Disclaimers and liability",
		body: (
			<>
				<p>
					Proyekto is provided "as is". To the extent the law allows, we exclude
					implied warranties, and we are not liable for indirect or
					consequential loss, or for lost profits or lost data.
				</p>
				<p>
					Where we are liable, our total liability is limited to the amount you
					paid us for Proyekto in the twelve months before the claim.
				</p>
				<p>
					Nothing here excludes liability that cannot legally be excluded,
					including for fraud. If you are a consumer, you keep the rights your
					local law gives you.
				</p>
			</>
		),
	},
	{
		id: "law",
		heading: "Governing law",
		body: (
			<p>
				These terms are governed by the laws of the Republic of the Philippines,
				and disputes go to the courts there — except where the law where you
				live gives you the right to bring a claim locally, which it may.
			</p>
		),
	},
	{
		id: "changes",
		heading: "Changes to these terms",
		body: (
			<p>
				We may update these terms. If a change materially affects you, we will
				update the date at the top and tell you in the product before it takes
				effect. Continuing to use Proyekto after that means the updated terms
				apply.
			</p>
		),
	},
	{
		id: "contact",
		heading: "Contact",
		body: (
			<p>
				Email <a href="mailto:support@proyekto.tech">support@proyekto.tech</a>{" "}
				or use the <Link to="/contact">contact form</Link>.
			</p>
		),
	},
];

function TermsPage() {
	useDocumentTitle("Terms of Service");
	return (
		<LegalPage
			title="Terms of Service"
			intro="The agreement for using Proyekto. Short, in plain language, and specific about what the product does and does not do."
			updated="23 September 2026"
			sections={SECTIONS}
		/>
	);
}
