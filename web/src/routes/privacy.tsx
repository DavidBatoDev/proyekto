import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPage, type LegalSection } from "@/components/legal/LegalPage";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { COMPANY, COMPANY_ADDRESS } from "@/lib/company";

/**
 * The privacy policy.
 *
 * Deliberately written in general, category-based terms (data categories,
 * recipient categories, "we may") rather than naming individual vendors or
 * fields, so routine code and vendor changes don't make it inaccurate. Keep
 * the overseas-countries line, the OAIC complaint line, and the
 * account-deletion path: the Privacy Act (APP 1/APP 8) and both app stores
 * require them.
 *
 * Reachable without an account: both app stores want a privacy-policy URL on
 * the listing, and signup links here.
 */
export const Route = createFileRoute("/privacy")({
	component: PrivacyPage,
});

const SECTIONS: LegalSection[] = [
	{
		id: "scope",
		heading: "What this policy covers",
		body: (
			<>
				<p>
					This Privacy Policy explains how <strong>{COMPANY.legalName}</strong>,{" "}
					{COMPANY_ADDRESS} ("Proyekto", "we", "us") treats Personal Data that
					we gather when you access or use our websites, web application and
					mobile applications (the "Services"). By using the Services, you
					acknowledge the practices described in this policy.
				</p>
				<p>
					"Personal Data" means any information that identifies or relates to a
					particular individual, including information treated as "personal
					information" under applicable privacy laws. This policy does not cover
					the practices of companies we don't own or control, or people we don't
					manage. We handle Personal Data in line with the Australian Privacy
					Principles in the <em>Privacy Act 1988</em> (Cth).
				</p>
			</>
		),
	},
	{
		id: "what-we-collect",
		heading: "Personal Data we collect",
		body: (
			<>
				<p>We may collect the following categories of Personal Data:</p>
				<ul>
					<li>
						<strong>Profile or contact data</strong>, such as your name, email
						address, sign-in credentials and profile details, including optional
						details you choose to add, such as your phone number, date of birth,
						gender, country, city and postal code.
					</li>
					<li>
						<strong>Work and compensation data</strong>, on plans that include
						time tracking, such as time logs, the pay rates a team sets for its
						members, and records of payouts made outside Proyekto.
					</li>
					<li>
						<strong>Payment data</strong>, such as billing details, collected
						and processed by our payment processing partner.
					</li>
					<li>
						<strong>Device and network data</strong>, such as IP address, device
						identifiers, and the type of device, operating system or browser you
						use.
					</li>
					<li>
						<strong>Usage data</strong>, such as how you interact with the
						Services, and logs and statistics about that interaction.
					</li>
					<li>
						<strong>Content you provide</strong>, such as the information you
						create, upload or share through the Services, including projects,
						tasks, messages, comments, meetings and the files, photos, videos
						and audio you attach.
					</li>
					<li>
						<strong>Safety data</strong>, such as the reports you submit about
						content or people (including a copy of the reported content, kept so
						we can review it) and the people you block.
					</li>
					<li>
						<strong>Other information you choose to provide</strong>, such as
						what you include when you contact us.
					</li>
				</ul>
				<p>
					We collect this information from you directly, automatically when you
					use the Services (including through cookies and similar technologies),
					and from third parties such as service providers and services you
					choose to connect.
				</p>
			</>
		),
	},
	{
		id: "how-we-use",
		heading: "How we use Personal Data",
		body: (
			<>
				<p>We may use Personal Data to:</p>
				<ul>
					<li>
						Provide, customize and improve the Services, including creating and
						managing accounts, processing transactions and billing, and
						providing support.
					</li>
					<li>
						Test, research, analyze and develop the Services and new features.
					</li>
					<li>Protect against fraud, maintain security, and debug.</li>
					<li>
						Correspond with you and send you information about Proyekto or the
						Services according to your preferences.
					</li>
					<li>Market the Services.</li>
					<li>
						Meet legal requirements, enforce our terms, resolve disputes, and
						protect the rights, property or safety of you, us or others.
					</li>
				</ul>
				<p>
					We will not use Personal Data for materially different, unrelated or
					incompatible purposes without giving you notice.
				</p>
			</>
		),
	},
	{
		id: "sharing",
		heading: "How we share Personal Data",
		body: (
			<>
				<ul>
					<li>
						<strong>Service providers</strong> that help us run the Services and
						our business, such as hosting, infrastructure, communications, AI
						and model providers, analytics, support and payment processors.
					</li>
					<li>
						<strong>Parties you authorize, access or authenticate</strong>, such
						as collaborators you give access to your work and third-party
						services you connect.
					</li>
					<li>
						<strong>Legal obligations.</strong> Where required by law, or in
						connection with the legal purposes described above.
					</li>
					<li>
						<strong>Business transfers.</strong> If we undergo a merger,
						acquisition, bankruptcy or similar transaction, Personal Data may be
						transferred to the party that assumes control of our business.
					</li>
				</ul>
				<p>
					We may also create aggregated, de-identified or anonymized data and
					use or share it for lawful business purposes, in a way that does not
					identify you.
				</p>
			</>
		),
	},
	{
		id: "cookies",
		heading: "Cookies and similar technologies",
		body: (
			<p>
				The Services may use cookies, local storage and similar technologies to
				keep you signed in, remember your preferences, and understand how the
				Services are used. You can control cookies through your browser
				settings, although some features may not work without them.
			</p>
		),
	},
	{
		id: "security-retention",
		heading: "Data security and retention",
		body: (
			<>
				<p>
					We use appropriate physical, technical, organizational and
					administrative measures to protect Personal Data. No method of
					transmission or storage is completely secure, so please also protect
					your password and devices.
				</p>
				<p>
					We retain Personal Data for as long as your account is open or as
					otherwise needed to provide the Services, and longer where necessary
					to comply with legal obligations, resolve disputes, collect fees, or
					as permitted by law. We may keep information in anonymized or
					aggregated form.
				</p>
			</>
		),
	},
	{
		id: "your-choices",
		heading: "Your choices and rights",
		body: (
			<>
				<p>
					You may request access to, correction of, or deletion of your Personal
					Data, and depending on where you live you may have further rights. We
					may need to verify your identity, and in some circumstances we may not
					be able to fully comply with a request, but we will tell you why.
				</p>
				<p>
					<strong>To delete your account</strong>, go to Settings → Delete
					account in the web app or mobile apps, or email{" "}
					<a href="mailto:support@proyekto.tech">support@proyekto.tech</a> from
					the address on the account. Some content you shared with others, and
					records we are required to keep, may be retained as described above.
				</p>
			</>
		),
	},
	{
		id: "children",
		heading: "Children",
		body: (
			<p>
				The Services are not directed at children, and we do not knowingly
				collect Personal Data from anyone under 16. If we learn that we have, we
				will delete it.
			</p>
		),
	},
	{
		id: "international",
		heading: "International transfers",
		body: (
			<p>
				Proyekto is operated from Australia, and we and our service providers
				may store and process Personal Data in other countries, including
				Singapore and the United States. Laws in those countries may differ from
				those where you live.
			</p>
		),
	},
	{
		id: "changes",
		heading: "Changes to this policy",
		body: (
			<p>
				We may change this policy from time to time. We will let you know by
				updating the date above and, where appropriate, by notice in the
				Services or by email. Using the Services after a change means you accept
				the updated policy.
			</p>
		),
	},
	{
		id: "contact",
		heading: "Contact",
		body: (
			<>
				<p>
					Email <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a> or use
					the <Link to="/contact">contact form</Link>. By post:{" "}
					{COMPANY.legalName}, {COMPANY_ADDRESS}.
				</p>
				<p>
					If you are not satisfied with how we handle a privacy complaint, you
					can complain to the Office of the Australian Information Commissioner
					at oaic.gov.au.
				</p>
			</>
		),
	},
];

function PrivacyPage() {
	useDocumentTitle("Privacy Policy");
	return (
		<LegalPage
			title="Privacy Policy"
			intro="How Proyekto collects, uses and shares Personal Data."
			updated="29 September 2026"
			sections={SECTIONS}
		/>
	);
}
