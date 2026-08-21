import type { ReactNode } from "react";
import {
	ChangeRequestIcon,
	DeliverableAcceptedIcon,
	RoadmapPreviewIcon,
	SignedContractIcon,
} from "@/components/marketplace/home/CapabilityIcons";
import { cn } from "@/lib/utils";
import {
	START_SELLING_PHOTOS,
	STOCK_PHOTO_HEIGHT,
	STOCK_PHOTO_WIDTH,
} from "./startSellingMedia";

/**
 * Six reasons, every one of them a feature that exists.
 *
 * The illustrations are the same `CapabilityIcons` the marketplace home page
 * uses for the client-facing version of this argument — the managed model is
 * one product, and drawing it twice would let the two drift.
 *
 * Nothing here claims volume, earnings or ratings. Those are the numbers a
 * marketplace page usually leans on and the ones this product cannot yet
 * substantiate.
 */

interface Card {
	eyebrow: string;
	title: string;
	body: string;
	art: ReactNode;
	/** Photo cards carry their own dark ground, so their text inverts. */
	onPhoto?: boolean;
}

function PhotoArt({ src }: { src: string }) {
	return (
		<>
			<img
				src={src}
				alt=""
				width={STOCK_PHOTO_WIDTH}
				height={STOCK_PHOTO_HEIGHT}
				loading="lazy"
				decoding="async"
				className="absolute inset-0 h-full w-full object-cover"
			/>
			<div
				aria-hidden="true"
				className="absolute inset-0 bg-linear-to-t from-black/85 via-black/35 to-black/10"
			/>
		</>
	);
}

const CARDS: Card[] = [
	{
		eyebrow: "Scope",
		title: "See the plan before you commit",
		body: "Work arrives as a roadmap with epics, features and tasks — not a paragraph and a deadline.",
		art: <RoadmapPreviewIcon className="h-28 w-28" />,
	},
	{
		eyebrow: "Control",
		title: "Work on your terms",
		body: "Your rate, your currency, your weekly hours, your availability. Change them whenever you like.",
		art: <PhotoArt src={START_SELLING_PHOTOS.focus} />,
		onPhoto: true,
	},
	{
		eyebrow: "Terms",
		title: "Signed, not agreed in a thread",
		body: "Rates, dates and scope live in a contract both sides sign. Amendments take effect going forward.",
		art: <SignedContractIcon className="h-28 w-28" />,
	},
	{
		eyebrow: "Delivery",
		title: "Accepted, then invoiced",
		body: "Work is checked against acceptance criteria and evidence, so payment is not a matter of opinion.",
		art: <DeliverableAcceptedIcon className="h-28 w-28" />,
	},
	{
		eyebrow: "People",
		title: "Staffed by leads, not a feed",
		body: "Vetted Solutions Leads build teams from the talent directory. You are picked, not lost in a queue.",
		art: <PhotoArt src={START_SELLING_PHOTOS.people} />,
		onPhoto: true,
	},
	{
		eyebrow: "Change",
		title: "Scope creep has a budget",
		body: "A change request carries its own cost and timeline impact, reviewed before it becomes your problem.",
		art: <ChangeRequestIcon className="h-28 w-28" />,
	},
];

export function WhyStartSelling() {
	return (
		<section className="mx-auto max-w-7xl px-4 pt-20 sm:px-6 lg:px-10 lg:pt-24">
			<h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
				A smarter way to work, grow, and earn
			</h2>

			<div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{CARDS.map((card) => (
					<article
						key={card.title}
						className={cn(
							"relative isolate flex min-h-[19rem] flex-col overflow-hidden rounded-2xl border",
							card.onPhoto
								? "border-transparent bg-muted"
								: "border-border bg-card",
						)}
					>
						<div
							className={cn(
								"flex flex-1 items-center justify-center",
								card.onPhoto ? "" : "text-primary",
							)}
						>
							{card.art}
						</div>

						<div className="relative p-5">
							<p
								className={cn(
									"text-[11px] font-semibold uppercase tracking-[0.14em]",
									card.onPhoto ? "text-white/70" : "text-muted-foreground",
								)}
							>
								{card.eyebrow}
							</p>
							<h3
								className={cn(
									"mt-1.5 text-[17px] font-semibold leading-snug",
									card.onPhoto ? "text-white" : "text-foreground",
								)}
							>
								{card.title}
							</h3>
							<p
								className={cn(
									"mt-2 text-[13px] leading-relaxed",
									card.onPhoto ? "text-white/80" : "text-muted-foreground",
								)}
							>
								{card.body}
							</p>
						</div>
					</article>
				))}
			</div>
		</section>
	);
}
