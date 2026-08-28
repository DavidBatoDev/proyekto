import type { ReactNode } from "react";
import {
	ChangeRequestIcon,
	DeliverableAcceptedIcon,
	RoadmapPreviewIcon,
	SignedContractIcon,
} from "@/components/marketplace/home/CapabilityIcons";
import { cn } from "@/lib/utils";
import {
	CONSULTANT_LANDING_PHOTOS,
	STOCK_PHOTO_HEIGHT,
	STOCK_PHOTO_WIDTH,
} from "./consultantLandingMedia";

/**
 * Six reasons to lead here, every one a feature that exists.
 *
 * Same card grid and the same `CapabilityIcons` the marketplace home and the
 * talent landing draw from — the managed model is one product, and drawing it
 * a third time would let the three drift. No volume, earnings or rating
 * claims, and no "lead pipeline (eventually)" promise: futures don't belong
 * on a page whose whole pitch is records you can point at.
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
		title: "Scope in roadmaps, not proposals",
		body: "Turn a client brief into epics, features and tasks on the canvas — with AI planning that drafts the structure for you.",
		art: <RoadmapPreviewIcon className="h-28 w-28" />,
	},
	{
		eyebrow: "Workspace",
		title: "A client workspace under your name",
		body: "Roadmap, chat, files, meetings and progress in one place. Clients see the work and your name on it — Proyekto is the rails.",
		art: <PhotoArt src={CONSULTANT_LANDING_PHOTOS.workspace} />,
		onPhoto: true,
	},
	{
		eyebrow: "Terms",
		title: "Signed, not agreed in a thread",
		body: "Rates, dates and scope live in a contract both sides sign. Amendments take effect going forward.",
		art: <SignedContractIcon className="h-28 w-28" />,
	},
	{
		eyebrow: "People",
		title: "A vetted talent bench",
		body: "Search the talent pool and invite the people you want on the project. You pick the team; the platform keeps the records.",
		art: <PhotoArt src={CONSULTANT_LANDING_PHOTOS.bench} />,
		onPhoto: true,
	},
	{
		eyebrow: "Delivery",
		title: "Acceptance you can point at",
		body: "Deliverables carry criteria and evidence, and get accepted explicitly — so 'done' is a state, not an argument.",
		art: <DeliverableAcceptedIcon className="h-28 w-28" />,
	},
	{
		eyebrow: "Commercials",
		title: "Contracts to payouts, built in",
		body: "Invoicing and payout records ride on the contract you signed. Stop chasing wire transfers and reconciling spreadsheets.",
		art: <ChangeRequestIcon className="h-28 w-28" />,
	},
];

export function WhyLeadOnProyekto() {
	return (
		<section className="mx-auto max-w-7xl px-4 pt-20 sm:px-6 lg:px-10 lg:pt-24">
			<h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
				Everything a firm gives you, minus the firm
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
