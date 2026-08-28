import { Briefcase, Building2, Crown, Workflow } from "lucide-react";

/**
 * The four people this page is recruiting, carried over from the old landing
 * page's personas. Selectivity is part of the pitch — "vetted" only means
 * something if some applications are declined.
 */
const PERSONAS = [
	{
		icon: Briefcase,
		title: "Fractional leaders",
		body: "Fractional CTOs, heads of product, or ops leads running 2–4 engagements at once.",
	},
	{
		icon: Workflow,
		title: "Freelance consultants",
		body: 'Solo consultants who keep getting asked, "can you bring a team for this?"',
	},
	{
		icon: Building2,
		title: "Boutique-agency founders",
		body: "Tired of running the back office and ready to ship faster with less overhead.",
	},
	{
		icon: Crown,
		title: "Ex-Big-4 / ex-McKinsey",
		body: "Building independent practice, looking for firm-quality tooling without the firm.",
	},
];

export function WhoThisIsFor() {
	return (
		<section className="mx-auto max-w-7xl px-4 pt-20 sm:px-6 lg:px-10 lg:pt-24">
			<h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
				You should be on Proyekto if you're…
			</h2>
			<p className="mt-3 max-w-2xl text-[15px] text-muted-foreground">
				We're selective on purpose — clients trust the consultant layer because
				not everyone gets through it.
			</p>

			<div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{PERSONAS.map((persona) => (
					<article
						key={persona.title}
						className="rounded-2xl border border-border bg-card p-5"
					>
						<span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
							<persona.icon className="h-4.5 w-4.5" />
						</span>
						<h3 className="mt-4 text-[17px] font-semibold text-foreground">
							{persona.title}
						</h3>
						<p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
							{persona.body}
						</p>
					</article>
				))}
			</div>
		</section>
	);
}
