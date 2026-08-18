import {
	ChangeRequestIcon,
	DeliverableAcceptedIcon,
	EngagementRecordIcon,
	RoadmapPreviewIcon,
	SignedContractIcon,
} from "./CapabilityIcons";

/**
 * What separates Proyekto from a freelancer directory: the delivery machinery
 * that starts the moment a contract is signed.
 *
 * Each card names a surface that genuinely exists in the product — not a
 * roadmap of intentions — so a buyer reading this can go and look at it.
 */
const CAPABILITIES = [
	{
		icon: RoadmapPreviewIcon,
		title: "A roadmap, before you commit",
		body: "See the epics, features and tasks your project breaks into while you are still deciding.",
	},
	{
		icon: DeliverableAcceptedIcon,
		title: "Deliverables with acceptance",
		body: "Work arrives against criteria and evidence, and is accepted explicitly rather than assumed.",
	},
	{
		icon: ChangeRequestIcon,
		title: "Change requests, not surprises",
		body: "Scope changes carry their own budget and timeline impact, reviewed before they land.",
	},
	{
		icon: SignedContractIcon,
		title: "Signed contracts and terms",
		body: "Rates, dates and scope live in a signed agreement; amendments take effect prospectively.",
	},
	{
		icon: EngagementRecordIcon,
		title: "Engagements that hold the history",
		body: "Who hired whom, on which projects, at which rates — durable long after a project closes.",
	},
];

export function WhyProyekto() {
	return (
		<section className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
			<h2 className="text-[17px] font-semibold text-foreground">
				Everything you need to deliver, not just to hire
			</h2>
			<div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{CAPABILITIES.map(({ icon: Icon, title, body }) => (
					<div
						key={title}
						className="rounded-xl border border-border bg-card p-4"
					>
						<Icon className="h-11 w-11" />
						<h3 className="mt-2.5 text-[13.5px] font-semibold text-foreground">
							{title}
						</h3>
						<p className="mt-1 text-[12.5px] text-muted-foreground">{body}</p>
					</div>
				))}
			</div>
		</section>
	);
}
