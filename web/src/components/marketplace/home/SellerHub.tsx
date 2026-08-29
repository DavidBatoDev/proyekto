import { Link } from "@tanstack/react-router";
import {
	ArrowRight,
	FileSignature,
	Layers,
	Settings2,
	UserRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { useProfileQuery } from "@/hooks/useProfileQuery";

/**
 * Per-persona seller desks on the marketplace home, each a titled section in
 * the house style: heading plus muted subtitle, matching the other bands on
 * this page. Today only the talent desk exists; a consultant desk lands
 * beside it later as another <HubSection> — the wrapper and card are already
 * generic so that addition is content, not structure.
 *
 * Renders nothing for accounts with no talent listing: the home stays a
 * storefront for everyone else.
 */
export function SellerHub() {
	const { data: profile } = useProfileQuery();

	// Paused talent still see their desk — services, contracts and the
	// profile are how a paused seller comes back.
	const talentStatus = profile?.talent_status ?? null;
	if (!profile || !talentStatus) return null;

	const name =
		profile.display_name ??
		[profile.first_name, profile.last_name].filter(Boolean).join(" ") ??
		"You";
	const isActive = talentStatus === "active";

	return (
		<HubSection
			title="Seller's Menu"
			subtitle="Your listing, services and contracts — everything you sell with, in one place."
		>
			<div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
				<div className="flex flex-wrap items-center gap-4">
					{profile.avatar_url ? (
						<img
							src={profile.avatar_url}
							alt={name}
							className="h-14 w-14 rounded-full object-cover"
						/>
					) : (
						<span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-xl font-semibold text-primary-foreground">
							{name.slice(0, 1).toUpperCase()}
						</span>
					)}
					<div className="min-w-0 flex-1">
						<h3 className="truncate text-lg font-semibold text-foreground">
							{name}
						</h3>
						<p className="truncate text-sm text-muted-foreground">
							{profile.email}
						</p>
						<p
							className={`mt-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${
								isActive
									? "text-emerald-600 dark:text-emerald-400"
									: "text-amber-600 dark:text-amber-400"
							}`}
						>
							Talent · {isActive ? "Open to work" : "Paused"}
						</p>
					</div>
					<Link
						to="/marketplace/talent/$profileId"
						params={{ profileId: profile.id }}
						className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
					>
						View profile
						<ArrowRight className="h-4 w-4" />
					</Link>
				</div>
			</div>

			<div className="mt-4 grid gap-4 sm:grid-cols-2">
				<HubCard
					icon={<UserRound className="h-5 w-5" />}
					title="Customize your profile"
					body="Headline, bio, skills, portfolio and your rate — edit the exact page clients see."
					to="/marketplace/talent/$profileId"
					params={{ profileId: profile.id }}
				/>
				<HubCard
					icon={<Layers className="h-5 w-5" />}
					title="My services"
					body="Productised offerings with tiered pricing that buyers can compare and contact you about."
					to="/marketplace/services"
				/>
				<HubCard
					icon={<FileSignature className="h-5 w-5" />}
					title="My contracts"
					body="Signed terms and engagements — who hired you, on what rates, with history that outlives the project."
					to="/engagements"
				/>
				<HubCard
					icon={<Settings2 className="h-5 w-5" />}
					title="Settings"
					body="Your listing status, rate and availability — the commercial controls of how you sell."
					to="/marketplace/talent/settings"
				/>
			</div>
		</HubSection>
	);
}

/** Section shell in the marketplace-home house style. */
function HubSection({
	title,
	subtitle,
	children,
}: {
	title: string;
	subtitle: string;
	children: ReactNode;
}) {
	return (
		<section className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
			{/* Bordered, and deliberately transparent inside it: the cards below
			    already carry `bg-card`, so filling this box too would flatten them
			    against their own container. The border alone is what gathers the
			    desk into one object.
			
			    `primary/50` rather than a literal purple, and rather than
			    `border-border`: it is the same token the cards use on hover, so the
			    box and the things inside it agree, and it follows the theme instead
			    of pinning one hex that would be wrong in dark mode. */}
			<div className="rounded-2xl border-2 border-dashed border-primary/50 p-5 sm:p-6">
				<div>
					<h2 className="text-[17px] font-semibold text-foreground">{title}</h2>
					<p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>
				</div>
				<div className="mt-4">{children}</div>
			</div>
		</section>
	);
}

function HubCard({
	icon,
	title,
	body,
	to,
	params,
	search,
}: {
	icon: ReactNode;
	title: string;
	body: string;
	to: string;
	params?: Record<string, string>;
	search?: Record<string, unknown>;
}) {
	return (
		<Link
			// Typed-router escape hatch: the card list mixes routes with and
			// without params, and the union collapses through this generic prop.
			to={to as never}
			params={params as never}
			search={search as never}
			className="group flex items-start gap-4 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/50"
		>
			<span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
				{icon}
			</span>
			<span className="min-w-0">
				<span className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
					{title}
					<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
				</span>
				<span className="mt-1 block text-[13px] leading-relaxed text-muted-foreground">
					{body}
				</span>
			</span>
		</Link>
	);
}
