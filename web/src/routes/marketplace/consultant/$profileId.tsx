import { createFileRoute, Link } from "@tanstack/react-router";
import { BadgeCheck, MapPin, User } from "lucide-react";
import { useState } from "react";
import { MarketplaceCategoryBar } from "@/components/marketplace/home/MarketplaceCategoryBar";
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
 * Laid out flat — headings and text directly on the page, with the only bordered
 * surface being the engage panel in the right rail. Wrapping each section in a
 * card broke the reading order into competing boxes; the sections are a single
 * column of prose about one person, so they read as one.
 *
 * Every field comes from the profile endpoint's own allowlist: name, avatar,
 * banner, headline, bio, location, when they joined, when they were verified,
 * and the taxonomy sub-categories they sit in. There is deliberately no rate,
 * star rating, review count, response time or availability dot — none of those
 * exist in the data model, and inventing them on a real person's public page
 * would be a lie a client could act on.
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

	const name = profile.display_name?.trim() || "Consultant";
	const initial = name.charAt(0).toUpperCase();
	const location = [profile.city, profile.country].filter(Boolean).join(", ");
	const expertise = profile.expertise ?? [];

	return (
		<div className="min-h-screen bg-background pt-app-header">
			<MarketplaceCategoryBar />

			<div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
				<div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
					<div className="min-w-0">
						<div className="flex items-start gap-6">
							<Avatar
								name={name}
								initial={initial}
								url={profile.avatar_url}
								className="h-24 w-24 shrink-0 text-3xl"
							/>

							<div className="min-w-0 pt-1">
								<div className="flex flex-wrap items-center gap-2">
									<h1 className="text-2xl font-bold text-foreground">{name}</h1>
									{profile.is_consultant_verified && (
										<span className="inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-700 dark:text-emerald-400">
											<BadgeCheck className="h-4 w-4 shrink-0" />
											Verified consultant
										</span>
									)}
								</div>

								{profile.headline ? (
									<p className="mt-2 text-[17px] font-medium text-foreground">
										{profile.headline}
									</p>
								) : (
									isOwner && (
										<p className="mt-2 text-[14px] text-muted-foreground">
											Add a headline in your profile settings — it is the one
											line clients read first.
										</p>
									)
								)}

								{location && (
									<p className="mt-2 inline-flex items-center gap-1.5 text-[14px] text-muted-foreground">
										<MapPin className="h-4 w-4 shrink-0" />
										{location}
									</p>
								)}
							</div>
						</div>

						<h2 className="mt-8 text-[15px] font-bold text-foreground">
							About me
						</h2>
						<About bio={profile.bio} isOwner={isOwner} />

						<h2 className="mt-8 text-[15px] font-bold text-foreground">
							Expertise
						</h2>
						<Expertise expertise={expertise} isOwner={isOwner} />

						<h2 className="mt-10 text-[15px] font-bold text-foreground">
							Work and reviews
						</h2>
						<p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
							Completed engagements and client feedback appear here. Proyekto
							records them from signed contracts and accepted deliverables
							rather than from self-reported claims, so nothing shows until{" "}
							{name} has finished work on the platform.
						</p>
					</div>

					<div className="lg:sticky lg:top-20 lg:self-start">
						<EngagePanel
							name={name}
							initial={initial}
							avatarUrl={profile.avatar_url}
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

function Avatar({
	name,
	initial,
	url,
	className,
}: {
	name: string;
	initial: string;
	url: string | null;
	className: string;
}) {
	return url ? (
		<img
			src={url}
			alt={name}
			className={`rounded-full object-cover ${className}`}
		/>
	) : (
		<div
			className={`flex items-center justify-center rounded-full bg-primary font-bold text-primary-foreground ${className}`}
		>
			{initial}
		</div>
	);
}

const BIO_CLAMP = 320;

function About({ bio, isOwner }: { bio: string | null; isOwner: boolean }) {
	const [expanded, setExpanded] = useState(false);
	const text = bio?.trim() ?? "";
	const isLong = text.length > BIO_CLAMP;

	if (!text) {
		return (
			<p className="mt-3 text-[15px] text-muted-foreground">
				{isOwner
					? "You have not written an overview yet. Describe the kind of work you lead and the outcomes clients get."
					: "This consultant has not written an overview yet."}
			</p>
		);
	}

	return (
		<p className="mt-3 max-w-2xl whitespace-pre-line text-[15px] leading-relaxed text-foreground">
			{isLong && !expanded ? `${text.slice(0, BIO_CLAMP).trimEnd()}… ` : text}
			{isLong && (
				// Inline with the last line, the way the reference reads — not a
				// button parked underneath the paragraph.
				<button
					type="button"
					onClick={() => setExpanded((current) => !current)}
					aria-expanded={expanded}
					className="ml-1 font-medium text-foreground underline hover:text-primary"
				>
					{expanded ? "Read less" : "Read more"}
				</button>
			)}
		</p>
	);
}

function Expertise({
	expertise,
	isOwner,
}: {
	expertise: ConsultantExpertise[];
	isOwner: boolean;
}) {
	if (expertise.length === 0) {
		return (
			<p className="mt-3 text-[15px] text-muted-foreground">
				{isOwner
					? "You are not listed under any category yet, so you will not appear when clients browse by discipline."
					: "This consultant is not listed under a category yet."}
			</p>
		);
	}

	return (
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
					className="rounded-full border border-border px-4 py-1.5 text-[14px] text-foreground transition-colors hover:border-foreground/40 hover:bg-muted"
				>
					{entry.subcategoryName}
				</Link>
			))}
		</div>
	);
}

const RAIL_BUTTON_CLASS =
	"inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border text-[14px] font-medium text-foreground transition-colors hover:bg-muted";

function EngagePanel({
	name,
	initial,
	avatarUrl,
	verifiedAt,
	createdAt,
	isOwner,
	profileId,
}: {
	name: string;
	initial: string;
	avatarUrl: string | null;
	verifiedAt: string | null;
	createdAt: string | null;
	isOwner: boolean;
	profileId: string;
}) {
	const verifiedLabel = formatMonthYear(verifiedAt);
	const joinedLabel = formatMonthYear(createdAt);

	return (
		<>
			<div className="grid grid-cols-2 gap-3">
				<Link to="/marketplace/consultant/browse" className={RAIL_BUTTON_CLASS}>
					All consultants
				</Link>
				{isOwner ? (
					<Link
						to="/profile/$profileId"
						params={{ profileId }}
						className={RAIL_BUTTON_CLASS}
					>
						Edit profile
					</Link>
				) : (
					<Link to="/marketplace/talent" className={RAIL_BUTTON_CLASS}>
						Find work
					</Link>
				)}
			</div>

			{/* The one bordered surface on the page, exactly where the reference
			    puts it: the panel you act from. */}
			<div className="mt-4 rounded-xl border border-border p-5">
				<div className="flex items-center gap-3">
					<Avatar
						name={name}
						initial={initial}
						url={avatarUrl}
						className="h-11 w-11 shrink-0 text-base"
					/>
					<div className="min-w-0">
						<p className="truncate text-[15px] font-semibold text-foreground">
							{name}
						</p>
						{verifiedLabel && (
							<p className="text-[13px] text-muted-foreground">
								Verified {verifiedLabel}
							</p>
						)}
					</div>
				</div>

				{isOwner ? (
					<>
						<p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
							This is your public profile. It is what clients see when they
							browse the marketplace.
						</p>
						<Link
							to="/marketplace/finance/contracts"
							className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-lg bg-foreground text-[14px] font-semibold text-background transition-opacity hover:opacity-90"
						>
							Your contracts
						</Link>
					</>
				) : (
					<>
						<p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
							Describe what you need. Scope, rates and dates are agreed in a
							signed contract before any work starts.
						</p>
						<Link
							to="/marketplace/project-posting"
							search={{ roadmapId: undefined }}
							className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-lg bg-foreground text-[14px] font-semibold text-background transition-opacity hover:opacity-90"
						>
							Post a project
						</Link>
					</>
				)}

				{joinedLabel && (
					<p className="mt-4 text-center text-[13px] text-muted-foreground">
						Member since {joinedLabel}
					</p>
				)}
			</div>
		</>
	);
}

/**
 * Dates render as a month, never a clock reading. The page this replaced showed
 * the VIEWER's current time labelled as the consultant's "local time", which was
 * wrong for anyone in another timezone — and a profile carries no timezone to
 * compute the real one from.
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
			<div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
				<div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
					<div className="space-y-4">
						<div className="flex items-start gap-6">
							<div className="h-24 w-24 shrink-0 animate-pulse rounded-full bg-muted" />
							<div className="flex-1 space-y-3 pt-2">
								<div className="h-6 w-48 animate-pulse rounded bg-muted" />
								<div className="h-4 w-64 animate-pulse rounded bg-muted" />
							</div>
						</div>
						<div className="h-24 animate-pulse rounded bg-muted" />
						<div className="h-16 animate-pulse rounded bg-muted" />
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
			<User className="h-12 w-12 text-muted-foreground" />
			<h1 className="mt-4 text-lg font-semibold text-foreground">
				Consultant not found
			</h1>
			<p className="mt-1 max-w-sm text-center text-[14px] text-muted-foreground">
				This profile may have been removed, or the consultant is no longer
				verified.
			</p>
			<Link
				to="/marketplace/consultant/browse"
				className="mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-foreground px-6 text-[14px] font-semibold text-background transition-opacity hover:opacity-90"
			>
				Browse consultants
			</Link>
		</div>
	);
}
