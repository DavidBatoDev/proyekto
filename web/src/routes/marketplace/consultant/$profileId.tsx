import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowLeft,
	BadgeCheck,
	CalendarDays,
	MapPin,
	Sparkles,
	User,
} from "lucide-react";
import { useState } from "react";
import { MarketplaceFooter } from "@/components/marketplace/MarketplaceFooter";
import { useConsultantProfileQuery } from "@/hooks/useConsultants";
import { useAuthStore } from "@/stores/authStore";
import type { ConsultantExpertise } from "@/types/marketplace-taxonomy";

export const Route = createFileRoute("/marketplace/consultant/$profileId")({
	component: ConsultantProfile,
});

/**
 * The public consultant profile.
 *
 * Every field on this page comes from the profile endpoint's own allowlist:
 * name, avatar, banner, headline, bio, location, when they joined, when they
 * were verified, and the taxonomy sub-categories they sit in. There is
 * deliberately no rate, rating, response time, availability dot or completed
 * project count — none of those exist in the data model, and inventing them on
 * a real person's public page would be a lie a client could act on.
 *
 * Sections that a marketplace profile eventually wants — packaged services,
 * portfolio, reviews — are represented by a single honest "no track record
 * yet" panel rather than three separate empty frames. They fill in once
 * engagements start completing.
 */
function ConsultantProfile() {
	const { profileId } = Route.useParams();
	const {
		data: profile,
		isLoading,
		error,
	} = useConsultantProfileQuery(profileId);
	const { user } = useAuthStore();
	const isOwner = user?.id === profileId;

	if (isLoading) return <ProfileSkeleton />;
	if (error || !profile) return <ProfileNotFound />;

	const fullName = profile.display_name?.trim() || "Consultant";
	const initial = fullName.charAt(0).toUpperCase();
	const location = [profile.city, profile.country].filter(Boolean).join(", ");
	const expertise = profile.expertise ?? [];

	return (
		<div className="min-h-screen bg-background pt-app-header">
			<div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
				<Link
					to="/marketplace/consultant/browse"
					className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" />
					All consultants
				</Link>

				<div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
					<div className="min-w-0 space-y-4">
						<IdentityCard
							name={fullName}
							initial={initial}
							avatarUrl={profile.avatar_url}
							bannerUrl={profile.banner_url}
							headline={profile.headline}
							location={location}
							verified={profile.is_consultant_verified}
							isOwner={isOwner}
						/>
						<AboutCard bio={profile.bio} isOwner={isOwner} />
						<ExpertiseCard expertise={expertise} isOwner={isOwner} />
						<TrackRecordCard name={fullName} />
					</div>

					<div className="lg:sticky lg:top-20 lg:self-start">
						<EngageCard
							name={fullName}
							verifiedAt={profile.consultant_verified_at}
							createdAt={profile.created_at}
							isOwner={isOwner}
							profileId={profileId}
						/>
					</div>
				</div>
			</div>

			<MarketplaceFooter />
		</div>
	);
}

const CARD_CLASS = "rounded-xl border border-border bg-card";

function IdentityCard({
	name,
	initial,
	avatarUrl,
	bannerUrl,
	headline,
	location,
	verified,
	isOwner,
}: {
	name: string;
	initial: string;
	avatarUrl: string | null;
	bannerUrl: string | null;
	headline: string | null;
	location: string;
	verified: boolean;
	isOwner: boolean;
}) {
	return (
		<section className={`${CARD_CLASS} overflow-hidden`}>
			{/* No banner is a valid state, so the fallback is a plain tint rather
			    than a placeholder image pretending something is missing. */}
			<div className="h-24 w-full bg-primary/10 sm:h-28">
				{bannerUrl && (
					<img
						src={bannerUrl}
						alt=""
						className="h-full w-full object-cover"
						loading="lazy"
					/>
				)}
			</div>

			<div className="px-5 pb-5">
				<div className="-mt-10 flex items-end gap-4">
					{avatarUrl ? (
						<img
							src={avatarUrl}
							alt={name}
							className="h-20 w-20 shrink-0 rounded-full border-4 border-card object-cover"
						/>
					) : (
						<div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-4 border-card bg-primary text-2xl font-bold text-primary-foreground">
							{initial}
						</div>
					)}
				</div>

				<div className="mt-3 flex flex-wrap items-center gap-2">
					<h1 className="text-xl font-semibold text-foreground">{name}</h1>
					{verified && (
						<span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300">
							<BadgeCheck className="h-3.5 w-3.5 shrink-0" />
							Verified consultant
						</span>
					)}
				</div>

				{headline ? (
					<p className="mt-1 text-[14px] text-foreground">{headline}</p>
				) : (
					isOwner && (
						<p className="mt-1 text-[13px] text-muted-foreground">
							Add a headline in your profile settings — it is the one line
							clients read first.
						</p>
					)
				)}

				{location && (
					<p className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
						<MapPin className="h-3.5 w-3.5 shrink-0" />
						{location}
					</p>
				)}
			</div>
		</section>
	);
}

const BIO_CLAMP = 420;

function AboutCard({ bio, isOwner }: { bio: string | null; isOwner: boolean }) {
	const [expanded, setExpanded] = useState(false);
	const text = bio?.trim() ?? "";
	const isLong = text.length > BIO_CLAMP;

	return (
		<section className={`${CARD_CLASS} p-5`}>
			<h2 className="text-[15px] font-semibold text-foreground">About</h2>
			{text ? (
				<>
					<p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-foreground">
						{isLong && !expanded
							? `${text.slice(0, BIO_CLAMP).trimEnd()}…`
							: text}
					</p>
					{isLong && (
						// The old page rendered this control but wired nothing to it.
						<button
							type="button"
							onClick={() => setExpanded((current) => !current)}
							aria-expanded={expanded}
							className="mt-2 text-[13px] font-semibold text-primary hover:underline"
						>
							{expanded ? "Show less" : "Read more"}
						</button>
					)}
				</>
			) : (
				<p className="mt-2 text-[13px] text-muted-foreground">
					{isOwner
						? "You have not written an overview yet. Describe the kind of work you lead and the outcomes clients get."
						: "This consultant has not written an overview yet."}
				</p>
			)}
		</section>
	);
}

function ExpertiseCard({
	expertise,
	isOwner,
}: {
	expertise: ConsultantExpertise[];
	isOwner: boolean;
}) {
	return (
		<section className={`${CARD_CLASS} p-5`}>
			<h2 className="text-[15px] font-semibold text-foreground">Expertise</h2>
			{expertise.length > 0 ? (
				<>
					<p className="mt-1 text-[13px] text-muted-foreground">
						The marketplace categories this consultant is listed under.
					</p>
					<div className="mt-3 flex flex-wrap gap-2">
						{expertise.map((entry) => (
							<Link
								key={`${entry.categorySlug}/${entry.subcategorySlug}`}
								to="/marketplace/category/$categorySlug/$subcategorySlug"
								params={{
									categorySlug: entry.categorySlug,
									subcategorySlug: entry.subcategorySlug,
								}}
								title={`${entry.categoryName} · ${entry.subcategoryName}`}
								className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
									entry.isPrimary
										? "border-primary/30 bg-primary/5 font-semibold text-foreground hover:bg-primary/10"
										: "border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
								}`}
							>
								{entry.isPrimary && (
									<Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
								)}
								{entry.subcategoryName}
							</Link>
						))}
					</div>
				</>
			) : (
				<p className="mt-2 text-[13px] text-muted-foreground">
					{isOwner
						? "You are not listed under any category yet, so you will not appear when clients browse by discipline."
						: "This consultant is not listed under a category yet."}
				</p>
			)}
		</section>
	);
}

function TrackRecordCard({ name }: { name: string }) {
	// One honest panel instead of three empty frames for services, portfolio and
	// reviews. Nothing in the product records any of them yet: there is no
	// review table, no packaged service, and no published portfolio.
	return (
		<section className={`${CARD_CLASS} p-5`}>
			<h2 className="text-[15px] font-semibold text-foreground">
				Work and reviews
			</h2>
			<p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
				Completed engagements and client feedback will appear here. Proyekto
				records them from signed contracts and accepted deliverables rather than
				from self-reported claims, so nothing shows until {name} has finished
				work on the platform.
			</p>
		</section>
	);
}

function EngageCard({
	name,
	verifiedAt,
	createdAt,
	isOwner,
	profileId,
}: {
	name: string;
	verifiedAt: string | null;
	createdAt: string | null;
	isOwner: boolean;
	profileId: string;
}) {
	const verifiedLabel = formatMonthYear(verifiedAt);
	const joinedLabel = formatMonthYear(createdAt);

	return (
		<section className={`${CARD_CLASS} p-5`}>
			{isOwner ? (
				<>
					<h2 className="text-[15px] font-semibold text-foreground">
						This is your public profile
					</h2>
					<p className="mt-1 text-[13px] text-muted-foreground">
						It is what clients see when they browse the marketplace.
					</p>
					<Link
						to="/profile/$profileId"
						params={{ profileId }}
						className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
					>
						Edit your profile
					</Link>
				</>
			) : (
				<>
					<h2 className="text-[15px] font-semibold text-foreground">
						Work with {name}
					</h2>
					<p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
						Describe what you need. Scope, rates and dates are agreed in a
						signed contract before any work starts.
					</p>
					<Link
						to="/marketplace/project-posting"
						search={{ roadmapId: undefined }}
						className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
					>
						Post a project
					</Link>
				</>
			)}

			<dl className="mt-5 space-y-2.5 border-t border-border pt-4 text-[13px]">
				{verifiedLabel && (
					<div className="flex items-center justify-between gap-3">
						<dt className="inline-flex items-center gap-1.5 text-muted-foreground">
							<BadgeCheck className="h-3.5 w-3.5 shrink-0" />
							Verified
						</dt>
						<dd className="font-medium text-foreground">{verifiedLabel}</dd>
					</div>
				)}
				{joinedLabel && (
					<div className="flex items-center justify-between gap-3">
						<dt className="inline-flex items-center gap-1.5 text-muted-foreground">
							<CalendarDays className="h-3.5 w-3.5 shrink-0" />
							Member since
						</dt>
						<dd className="font-medium text-foreground">{joinedLabel}</dd>
					</div>
				)}
			</dl>
		</section>
	);
}

/**
 * Dates render as a month, never a clock reading. The old page showed the
 * VIEWER's current time labelled as the consultant's "local time", which was
 * wrong for anyone in a different timezone — and there is no timezone on a
 * profile to compute the real one from.
 */
function formatMonthYear(value: string | null): string | null {
	if (!value) return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return new Intl.DateTimeFormat(undefined, {
		month: "long",
		year: "numeric",
	}).format(date);
}

function ProfileSkeleton() {
	return (
		<div className="min-h-screen bg-background pt-app-header">
			<div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
				<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
					<div className="space-y-4">
						<div className="h-56 animate-pulse rounded-xl bg-muted" />
						<div className="h-32 animate-pulse rounded-xl bg-muted" />
						<div className="h-32 animate-pulse rounded-xl bg-muted" />
					</div>
					<div className="h-64 animate-pulse rounded-xl bg-muted" />
				</div>
			</div>
		</div>
	);
}

function ProfileNotFound() {
	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 pt-app-header">
			<div className={`${CARD_CLASS} w-full max-w-md p-8 text-center`}>
				<User className="mx-auto h-12 w-12 text-muted-foreground" />
				<h1 className="mt-4 text-lg font-semibold text-foreground">
					Consultant not found
				</h1>
				<p className="mt-1 text-[13px] text-muted-foreground">
					This profile may have been removed, or the consultant is no longer
					verified.
				</p>
				<Link
					to="/marketplace/consultant/browse"
					className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
				>
					<ArrowLeft className="h-4 w-4" />
					Browse consultants
				</Link>
			</div>
		</div>
	);
}
