import { Link } from "@tanstack/react-router";
import { BadgeCheck, Clock, Languages, MapPin } from "lucide-react";
import { CategoryArt } from "@/components/marketplace/category/CategoryArt";
import type {
	ConsultantDirectoryItem,
	ConsultantDirectoryService,
} from "@/queries/consultants";

/**
 * The wide result row on the browse page.
 *
 * Deliberately richer than `ConsultantCard` (the four-up grid tile used on
 * category pages): this is the surface where somebody compares candidates, so
 * it carries the published catalog strip, the skill chips and the price line.
 * It still shows only fields that exist — no rating, no response time, no
 * "online now" — because inventing those here is how a placeholder quietly
 * becomes a promise.
 */
export function ConsultantResultCard({
	consultant,
}: {
	consultant: ConsultantDirectoryItem;
}) {
	const name =
		consultant.display_name ||
		`${consultant.first_name ?? ""} ${consultant.last_name ?? ""}`.trim() ||
		"Consultant";
	const place = [consultant.city, consultant.country]
		.filter(Boolean)
		.join(", ");
	const skills = consultant.skills ?? [];
	const visibleSkills = skills.slice(0, 6);
	const hiddenSkillCount = skills.length - visibleSkills.length;
	const services = consultant.services ?? [];
	const languages = consultant.languages ?? [];
	const fastestDelivery = services
		.map((service) => service.delivery_days)
		.filter((days): days is number => typeof days === "number")
		.sort((a, b) => a - b)[0];

	return (
		<article className="rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-sm">
			<div className="flex items-start gap-3">
				{consultant.avatar_url ? (
					<img
						src={consultant.avatar_url}
						alt=""
						className="h-11 w-11 shrink-0 rounded-full object-cover"
					/>
				) : (
					<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[15px] font-semibold text-primary">
						{name.charAt(0).toUpperCase()}
					</span>
				)}

				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<Link
							to="/marketplace/consultant/$profileId"
							params={{ profileId: consultant.id }}
							preload="intent"
							className="text-[14.5px] font-semibold text-foreground hover:underline"
						>
							{name}
						</Link>
						<span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
							<BadgeCheck className="h-3 w-3" />
							Vetted
						</span>
						{consultant.rates?.availability === "available" && (
							<span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
								Available now
							</span>
						)}
					</div>

					{(consultant.headline || consultant.bio) && (
						<p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">
							{consultant.headline || consultant.bio}
						</p>
					)}

					<div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
						{place && (
							<span className="inline-flex items-center gap-1">
								<MapPin className="h-3 w-3" />
								{place}
							</span>
						)}
						{languages.length > 0 && (
							<span className="inline-flex items-center gap-1">
								<Languages className="h-3 w-3" />
								{languages
									.slice(0, 3)
									.map((language) => language.name)
									.join(", ")}
							</span>
						)}
						{fastestDelivery !== undefined && (
							<span className="inline-flex items-center gap-1">
								<Clock className="h-3 w-3" />
								From {fastestDelivery} day
								{fastestDelivery === 1 ? "" : "s"} delivery
							</span>
						)}
					</div>
				</div>

				<Link
					to="/marketplace/consultant/$profileId"
					params={{ profileId: consultant.id }}
					preload="intent"
					className="hidden shrink-0 rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted sm:inline-block"
				>
					See profile
				</Link>
			</div>

			{visibleSkills.length > 0 && (
				<ul className="mt-3 flex flex-wrap gap-1.5">
					{visibleSkills.map((skill) => (
						<li
							key={skill.slug}
							className="rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground"
						>
							{skill.name}
						</li>
					))}
					{hiddenSkillCount > 0 && (
						<li className="rounded-full px-2 py-1 text-[11.5px] font-medium text-primary">
							+{hiddenSkillCount}
						</li>
					)}
				</ul>
			)}

			{services.length > 0 && (
				// Capped height on purpose: a wide row gives each cover a third of
				// ~1000px, and an uncapped aspect ratio would let three thumbnails
				// dwarf the person the card is about.
				<div className="mt-3 grid gap-2 sm:grid-cols-3">
					{services.map((service, index) => (
						<ServiceTile
							key={service.id}
							service={service}
							index={index}
							consultantId={consultant.id}
						/>
					))}
				</div>
			)}

			<div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
				<span className="text-[12px] text-muted-foreground">
					{consultant.service_count > 0
						? `${consultant.service_count} published ${
								consultant.service_count === 1 ? "service" : "services"
							}`
						: "Scopes the work with you before anything is agreed"}
				</span>
				<div className="flex items-center gap-4">
					{consultant.rates?.hourlyRate != null && (
						<span className="text-[12.5px] text-muted-foreground">
							{formatPrice(
								consultant.rates.hourlyRate,
								consultant.rates.currency,
							)}
							/hr
						</span>
					)}
					{consultant.starting_from && (
						<span className="text-[13px] font-semibold text-foreground">
							From{" "}
							{formatPrice(
								consultant.starting_from.amount,
								consultant.starting_from.currency,
							)}
							<span className="font-normal text-muted-foreground">
								/{consultant.starting_from.unit}
							</span>
						</span>
					)}
				</div>
			</div>

			<Link
				to="/marketplace/consultant/$profileId"
				params={{ profileId: consultant.id }}
				className="mt-3 block rounded-lg border border-border py-2 text-center text-[12.5px] font-semibold text-foreground sm:hidden"
			>
				See profile
			</Link>
		</article>
	);
}

/**
 * A catalog entry's cover. Falls back to the same generated artwork the
 * category tiles use rather than a stock photo — a photo would claim something
 * about work that was never delivered here.
 */
function ServiceTile({
	service,
	index,
	consultantId,
}: {
	service: ConsultantDirectoryService;
	index: number;
	consultantId: string;
}) {
	return (
		<Link
			to="/marketplace/consultant/$profileId"
			params={{ profileId: consultantId }}
			preload="intent"
			className="group overflow-hidden rounded-lg border border-border"
		>
			{service.cover_url ? (
				<img
					src={service.cover_url}
					alt=""
					className="h-[132px] w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
				/>
			) : (
				<CategoryArt
					slug={service.id}
					index={index}
					className="h-[132px] w-full"
				/>
			)}
			<span className="block truncate px-2 py-1.5 text-[12px] text-foreground">
				{service.title}
			</span>
		</Link>
	);
}

function formatPrice(amount: number, currency: string): string {
	try {
		return new Intl.NumberFormat(undefined, {
			style: "currency",
			currency,
			maximumFractionDigits: 0,
		}).format(amount);
	} catch {
		// An unknown currency code must not take the card down with it.
		return `${currency} ${Math.round(amount).toLocaleString()}`;
	}
}
