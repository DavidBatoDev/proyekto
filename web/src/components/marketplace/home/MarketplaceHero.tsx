import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useMarketplaceSurveyQuery } from "@/hooks/useMarketplaceSurvey";
import { isActiveConsultant } from "@/lib/auth-utils";
import { heroCtaFor } from "@/lib/marketplaceSurvey";
import { useProfile, useUser } from "@/stores/authStore";
import { HeroCarousel, type HeroSlide } from "./HeroCarousel";

const DIM = { w: 1200, h: 900 } as const;

/**
 * The promo slides. Each clip is authored in `remotion/` (`HeroStory`,
 * `HeroConsultantStory`, `HeroTemplateStory`); bump the `?v=` when one is
 * re-rendered, and keep `steps` in step with what the clip shows — the video is
 * aria-hidden, so `steps` is the only version a screen reader gets.
 *
 * Every destination is a route that exists today. A promo band pointing at a
 * page that is not built yet is the worst place in the product to find that
 * out, because it is the first thing a visitor clicks.
 */
const SLIDES: readonly HeroSlide[] = [
	{
		key: "brief",
		eyebrow: "Post a brief",
		headline: "Describe what you need and a vetted consultant will scope it.",
		cta: {
			label: "Post a brief",
			to: "/brief/new",
			search: { need: undefined },
		},
		clip: {
			src: "/hero-brief.mp4?v=1",
			poster: "/hero-brief-poster.webp?v=1",
			dimensions: DIM,
			steps: [
				"Describe what you need",
				"A vetted consultant scopes it",
				"Roadmap, deliverables and terms — before any work starts",
			],
		},
	},
	{
		key: "consultant",
		eyebrow: "Hire a consultant",
		headline: "Consultants who lead delivery end to end, not just advise.",
		cta: { label: "Browse consultants", to: "/marketplace/consultant/browse" },
		clip: {
			src: "/hero-consultant.mp4?v=1",
			poster: "/hero-consultant-poster.webp?v=1",
			dimensions: DIM,
			steps: [
				"Vetted consultants, each reviewed by a human",
				"One takes the lead on your project",
				"They own the delivery end to end",
			],
		},
	},
	{
		key: "template",
		eyebrow: "Solution templates",
		headline: "Start from a proven plan and adapt it to your project.",
		cta: { label: "Browse templates", to: "/roadmap-templates" },
		clip: {
			src: "/hero-template.mp4?v=1",
			poster: "/hero-template-poster.webp?v=1",
			dimensions: DIM,
			steps: [
				"Pick a solution template",
				"It opens into epics, features and tasks",
				"Adapt it before any work starts",
			],
		},
	},
];

/**
 * The marketplace's opening move: a welcome line and a rotating promo band.
 *
 * Every slide destination is a surface that already exists — the brief flow,
 * the consultant directory, the template catalogue. Slide one says "Post a
 * brief" rather than "Post a project" because that is literally what it
 * creates; `/project/new` is the other thing entirely (running your own
 * project) and is reached from the dashboard.
 *
 * Each slide is 70/30 from `lg` up, with its clip on the right. Below `lg` the
 * clip is dropped rather than stacked — it is demonstration, not information,
 * and stacking three of them would bury the rest of the page.
 *
 * When the viewer has taken the intake survey and said they are here to WORK
 * rather than to hire, a band above the card offers the step that actually
 * matches. Someone here to hire gets nothing extra: the post/hire toggle below
 * already is their call to action. See `heroCtaFor`.
 */
export function MarketplaceHero() {
	const user = useUser();
	const profile = useProfile();
	// Capability comes from the profile, never from the survey — it picks the
	// destination so an unverified lead is sent to apply instead of to a page
	// that would turn them away.
	const surveyQuery = useMarketplaceSurveyQuery();
	const cta = heroCtaFor(surveyQuery.data?.intents, {
		isConsultant: isActiveConsultant(profile),
		userId: user?.id,
	});

	const firstName =
		profile?.first_name ?? profile?.display_name?.split(" ")[0] ?? null;

	return (
		<section className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
			<div className="flex items-baseline justify-between gap-4">
				<h1 className="text-[15px] text-foreground">
					{firstName ? (
						<>
							Welcome, <span className="font-semibold">{firstName}</span>
						</>
					) : (
						<span className="font-semibold">Welcome to the marketplace</span>
					)}
				</h1>
				{user && isActiveConsultant(profile) && (
					<Link
						to="/marketplace/finance"
						className="text-[13px] font-medium text-primary hover:underline"
					>
						Your finance
					</Link>
				)}
			</div>

			{cta && (
				<div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-4">
					<div className="min-w-0">
						<p className="text-[15px] font-semibold text-foreground">
							{cta.headline}
						</p>
						<p className="mt-0.5 text-[13px] text-muted-foreground">
							{cta.subhead}
						</p>
					</div>
					<Link
						to={cta.to}
						className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
					>
						{cta.label}
						<ArrowRight className="h-3.5 w-3.5" />
					</Link>
				</div>
			)}

			<HeroCarousel slides={SLIDES} />
		</section>
	);
}
