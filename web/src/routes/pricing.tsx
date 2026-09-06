import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import { PricingCards } from "@/components/pricing/PricingCards";
import { PricingComparison } from "@/components/pricing/PricingComparison";

/**
 * The public pricing page.
 *
 * Deliberately outside `PresentationContainer`: the landing page is a
 * snap-scrolling deck of full-height sections, and this is a long document you
 * read top to bottom and scroll back up in. It carries its own slim header for
 * the same reason — the marketing one drives the deck's section navigation and
 * cannot render without that context.
 */
export const Route = createFileRoute("/pricing")({
	component: PricingPage,
});

const FAQ = [
	{
		q: "What counts as a seat?",
		a: "Anyone in your workspace. Free holds up to 10 people; on a paid plan you add as many as you like and are billed for each. Teams, projects and roadmaps are not seats, and someone with access to a single shared roadmap is not one either.",
	},
	{
		q: "What is an AI message?",
		a: "One thing you say to the assistant. Its own follow-up work — reading the roadmap, drafting the change, applying it — is part of that same message, not extra ones.",
	},
	{
		q: "What happens when I hit a limit on Free?",
		a: "Nothing is deleted and nothing locks. You keep everything you have built and read it as normal; creating past the limit is what waits for an upgrade.",
	},
	{
		q: "Can I change plans later?",
		a: "Yes, in either direction, and a mid-cycle change is prorated. Downgrading keeps your data — the features above the new plan stop being editable rather than disappearing.",
	},
	{
		q: "How do I pay from the mobile app?",
		a: "Plans are managed on the web at proyekto.tech. Sign in on your phone afterwards and the app picks up your plan automatically.",
	},
	{
		q: "Do you offer discounts?",
		a: "Yearly billing is the discount, and it is on the switch above. Talk to us if you are a nonprofit or an early-stage startup.",
	},
];

function PricingPage() {
	const [yearly, setYearly] = useState(true);

	return (
		<div className="min-h-screen bg-background">
			<header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-xl">
				<div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
					<Link to="/" aria-label="Proyekto home">
						<BrandMark variant="lockup" className="h-8" />
					</Link>
					<div className="flex items-center gap-2">
						<Link
							to="/auth/login"
							search={{ redirect: undefined }}
							className="rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
						>
							Log in
						</Link>
						<Link
							to="/auth/signup"
							search={{ redirect: undefined }}
							className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-dark"
						>
							Get started
						</Link>
					</div>
				</div>
			</header>

			<main className="mx-auto w-full max-w-6xl px-5 pb-24 sm:px-8">
				<section className="pb-10 pt-16 sm:pt-20">
					<h1 className="text-4xl font-bold tracking-tight text-foreground">
						Pricing
					</h1>
					<p className="mt-3 max-w-xl text-base text-muted-foreground">
						Plan it with AI, run the delivery in one place. Start free and pay
						once your team is actually shipping.
					</p>
				</section>

				<PricingCards yearly={yearly} onBillingChange={setYearly} />

				<section className="pt-24">
					<PricingComparison />
				</section>

				<section className="pt-24">
					<h2 className="text-2xl font-bold tracking-tight text-foreground">
						Questions
					</h2>
					<dl className="mt-8 grid grid-cols-1 gap-x-12 gap-y-8 md:grid-cols-2">
						{FAQ.map((item) => (
							<div key={item.q}>
								<dt className="text-sm font-semibold text-foreground">
									{item.q}
								</dt>
								<dd className="mt-2 text-sm leading-relaxed text-muted-foreground">
									{item.a}
								</dd>
							</div>
						))}
					</dl>
				</section>

				<section className="mt-24 rounded-2xl border border-border bg-muted px-8 py-12 text-center">
					<h2 className="text-2xl font-bold tracking-tight text-foreground">
						Start with a roadmap, not a subscription
					</h2>
					<p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
						Describe your project and the assistant drafts the plan. No card, no
						trial clock.
					</p>
					<Link
						to="/auth/signup"
						search={{ redirect: undefined }}
						className="mt-7 inline-flex h-11 items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-dark"
					>
						Get started free
					</Link>
				</section>
			</main>
		</div>
	);
}
