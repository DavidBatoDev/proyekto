import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { AudienceVideo } from "@/components/marketplace/AudienceVideo";
import { ApplicationChecklist } from "@/components/marketplace/consultant/landing/ApplicationChecklist";
import { ApplyCtaButton } from "@/components/marketplace/consultant/landing/ApplyCtaButton";
import { ConsultantFaq } from "@/components/marketplace/consultant/landing/ConsultantFaq";
import { WhoThisIsFor } from "@/components/marketplace/consultant/landing/WhoThisIsFor";
import { WhyLeadOnProyekto } from "@/components/marketplace/consultant/landing/WhyLeadOnProyekto";
import { MarketplaceFooter } from "@/components/marketplace/MarketplaceFooter";
import { GoLiveChecklist } from "@/components/marketplace/talent/landing/GoLiveChecklist";
import { HowYouGetPaid } from "@/components/marketplace/talent/landing/HowYouGetPaid";
import { OpportunitiesByCategory } from "@/components/marketplace/talent/landing/OpportunitiesByCategory";
import { StartSellingCtaButton } from "@/components/marketplace/talent/landing/StartSellingCtaButton";
import {
	START_SELLING_PHOTOS,
	STOCK_PHOTO_HEIGHT,
	STOCK_PHOTO_WIDTH,
} from "@/components/marketplace/talent/landing/startSellingMedia";
import { WhyStartSelling } from "@/components/marketplace/talent/landing/WhyStartSelling";

/**
 * The supply-side storefront: one page for everyone who wants to earn on
 * Proyekto, replacing the separate /marketplace/talent and
 * /marketplace/consultant landings (both redirect here; the consultant one
 * lands on the #lead-engagements anchor).
 *
 * One continuous scroll, deliberately not tabbed: the two offers share a
 * hero and a commercial spine, and a reader deciding which door is theirs
 * should be able to compare without flipping. Sections that both stories
 * duplicated — the live-taxonomy opportunities grid and the
 * contracts→acceptance→invoices→payouts band — appear once. The audience
 * blocks are the existing landing components, untouched.
 */
/**
 * The two explainer clips, authored in `remotion/` and rendered to
 * `web/public/`. `steps` is the text alternative for the video, and repeats the
 * captions baked into it — keep the two in sync when a composition changes.
 * Bump `?v=` whenever a clip is re-rendered.
 */
const TALENT_CLIP = {
	src: "/talent-story.mp4?v=1",
	poster: "/talent-story-poster.webp?v=1",
	steps: [
		"A profile clients can hire from",
		"Your rate, your hours, your currency",
		"Vetted leads staff you onto real projects",
		"Accepted, invoiced, paid out",
	],
} as const;

const CONSULTANT_CLIP = {
	src: "/consultant-story.mp4?v=1",
	poster: "/consultant-story-poster.webp?v=1",
	steps: [
		"Turn a brief into scoped work",
		"Epics, features and tasks on a canvas",
		"Staff it from a vetted talent bench",
		"Signed terms, acceptance you can point at",
	],
} as const;

export const Route = createFileRoute("/start-selling")({
	component: StartSellingPage,
});

function StartSellingPage() {
	// The old landing routes redirect here with an anchor (#lead-engagements),
	// and the router sets the hash without scrolling to it on a fresh mount —
	// so honour it ourselves once the sections have painted.
	useEffect(() => {
		const hash = window.location.hash.slice(1);
		if (!hash) return;
		// Deferred past the router's own post-navigation scroll-to-top, and via
		// window.scrollTo rather than scrollIntoView — the latter is silently
		// inert on this page (observed: scrollY unchanged with the element
		// 3500px below the fold), while a computed scrollTo works.
		const scrollToTarget = () => {
			const target = document.getElementById(hash);
			if (!target) return;
			const top = target.getBoundingClientRect().top + window.scrollY - 90;
			window.scrollTo({ top, behavior: "instant" });
		};
		// Twice: once fast, once after the async sections (taxonomy grid,
		// photos) have settled the layout and moved the anchor.
		const first = setTimeout(scrollToTarget, 150);
		const second = setTimeout(scrollToTarget, 700);
		return () => {
			clearTimeout(first);
			clearTimeout(second);
		};
	}, []);

	return (
		<div className="min-h-screen bg-background pt-app-header">
			<CombinedHero />

			<AudienceDivider
				id="sell-your-work"
				eyebrow="For talent"
				title="Sell your work"
				body="Join the pool that vetted leads staff real projects from. You set your rate, your hours, and which projects you say yes to."
			/>
			<AudienceVideo
				src={TALENT_CLIP.src}
				poster={TALENT_CLIP.poster}
				steps={TALENT_CLIP.steps}
			/>
			<WhyStartSelling />
			<OpportunitiesByCategory />
			<HowYouGetPaid />
			<GoLiveChecklist />

			<AudienceDivider
				id="lead-engagements"
				eyebrow="For consultants"
				title="Lead engagements"
				body="Become one of Proyekto's vetted delivery leads: scope the work, staff it from the talent bench, sign the terms, and own the outcome."
			/>
			<AudienceVideo
				src={CONSULTANT_CLIP.src}
				poster={CONSULTANT_CLIP.poster}
				steps={CONSULTANT_CLIP.steps}
			/>
			<WhyLeadOnProyekto />
			<WhoThisIsFor />
			<ApplicationChecklist />
			<ConsultantFaq />

			<CombinedCta />
			<MarketplaceFooter />
		</div>
	);
}

/**
 * One hero, two doors. Each button keeps its own status-aware logic —
 * the talent one routes to go-live, the consultant one follows the
 * application lifecycle.
 */
function CombinedHero() {
	return (
		<section className="relative isolate overflow-hidden bg-muted">
			<img
				src={START_SELLING_PHOTOS.hero}
				alt=""
				width={STOCK_PHOTO_WIDTH}
				height={STOCK_PHOTO_HEIGHT}
				loading="eager"
				fetchPriority="high"
				decoding="async"
				className="absolute inset-0 -z-10 h-full w-full object-cover"
			/>
			<div
				aria-hidden="true"
				className="absolute inset-0 -z-10 bg-linear-to-r from-black/80 via-black/60 to-black/30"
			/>

			<div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
				<div className="max-w-2xl">
					<p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-white/70">
						Earn on Proyekto
					</p>
					<h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">
						Start selling on Proyekto
					</h1>
					<p className="mt-5 max-w-xl text-[15px] leading-relaxed text-white/85">
						Two ways in, one managed model: sell your work as talent that vetted
						leads staff onto real projects — or become one of those leads
						yourself, scoping and owning delivery end to end. Either way: scoped
						work, signed terms, and acceptance before invoicing.
					</p>
					<div className="mt-8 flex flex-wrap items-center gap-3">
						<StartSellingCtaButton tone="onPhoto" />
						<ApplyCtaButton />
					</div>
					<p className="mt-4 text-[13px] text-white/70">
						Free to list as talent · Consultants pass a human review
					</p>
				</div>
			</div>
		</section>
	);
}

/**
 * The seam between the two stories: a full-width band that names the
 * audience, so someone scanning knows exactly where their half starts. The
 * `id` doubles as the anchor the old consultant landing redirects to.
 */
function AudienceDivider({
	id,
	eyebrow,
	title,
	body,
}: {
	id: string;
	eyebrow: string;
	title: string;
	body: string;
}) {
	return (
		<div
			id={id}
			className="mt-20 scroll-mt-24 border-y border-border bg-muted/40 lg:mt-24"
		>
			<div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-10">
				<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
					{eyebrow}
				</p>
				<h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
					{title}
				</h2>
				<p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
					{body}
				</p>
			</div>
		</div>
	);
}

/** One closing band, both asks — same dark-ground rationale as before. */
function CombinedCta() {
	return (
		<section className="relative isolate mt-20 overflow-hidden bg-black lg:mt-24">
			<img
				src={START_SELLING_PHOTOS.closing}
				alt=""
				width={STOCK_PHOTO_WIDTH}
				height={STOCK_PHOTO_HEIGHT}
				loading="lazy"
				decoding="async"
				className="absolute inset-0 -z-10 h-full w-full object-cover opacity-60"
			/>
			<div aria-hidden="true" className="absolute inset-0 -z-10 bg-black/55" />

			<div className="mx-auto flex max-w-3xl flex-col items-center px-4 py-20 text-center sm:px-6 lg:py-24">
				<h2 className="text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
					Ready to earn on Proyekto?
				</h2>
				<p className="mt-4 max-w-xl text-[15px] leading-relaxed text-white/80">
					List your work in minutes, or apply to lead delivery — both doors open
					onto the same managed model.
				</p>
				<div className="mt-8 flex flex-wrap items-center justify-center gap-3">
					<StartSellingCtaButton tone="onPhoto" />
					<ApplyCtaButton />
				</div>
			</div>
		</section>
	);
}
