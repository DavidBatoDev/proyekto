import type { ReactNode } from "react";
import { formatPrice } from "@/components/marketplace/consultant/ConsultantServices";
import type { ConsultantPublicRates } from "@/queries/consultants";
import { SectionEditButton } from "./EditableSection";
import { formatAvailability, formatMonthYear } from "./formatters";
import { SellerAvatar } from "./SellerAvatar";

export const RAIL_BUTTON_CLASS =
	"inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border text-[14px] font-medium text-foreground transition-colors hover:bg-muted";

export const RAIL_CTA_CLASS =
	"mt-4 inline-flex h-11 w-full items-center justify-center rounded-lg bg-foreground text-[14px] font-semibold text-background transition-opacity hover:opacity-90";

/**
 * The sticky rail both public seller profiles act from — the one bordered
 * surface on the page, exactly where the reference puts it. The page decides
 * who it is for: `topLinks` fills the 2-up button row, `note` + `cta` carry
 * the owner-vs-visitor ask, and `onEditRates` (owner only) puts the WYSIWYG
 * pencil on the rate line.
 *
 * Availability is the seller's own word, never a live presence check — a
 * profile carries no session or timezone to compute one from.
 */
export function EngagePanel({
	name,
	initial,
	avatarUrl,
	rates,
	statusLine,
	topLinks,
	note,
	cta,
	createdAt,
	onEditRates,
}: {
	name: string;
	initial: string;
	avatarUrl: string | null;
	rates: ConsultantPublicRates | null;
	/** Shown under the name when there is no hourly rate to show. */
	statusLine: string | null;
	topLinks: ReactNode;
	note: string;
	cta: ReactNode;
	createdAt: string | null;
	onEditRates?: () => void;
}) {
	const joinedLabel = formatMonthYear(createdAt);
	const hourlyRate = rates?.hourlyRate ?? null;

	return (
		<>
			<div className="grid grid-cols-2 gap-3">{topLinks}</div>

			<div className="mt-4 rounded-xl border border-border p-5">
				<div className="flex items-center gap-3">
					<SellerAvatar
						name={name}
						initial={initial}
						url={avatarUrl}
						className="h-11 w-11 shrink-0 text-base"
					/>
					<div className="min-w-0">
						<p className="truncate text-[15px] font-semibold text-foreground">
							{name}
						</p>
						{hourlyRate !== null && rates ? (
							<p className="text-[15px] font-bold text-foreground">
								{formatPrice(hourlyRate, rates.currency)}
								<span className="font-normal text-muted-foreground">/hour</span>
								{onEditRates && (
									<SectionEditButton label="Edit rate" onClick={onEditRates} />
								)}
							</p>
						) : onEditRates ? (
							<button
								type="button"
								onClick={onEditRates}
								className="cursor-pointer text-[13px] font-medium text-primary hover:underline"
							>
								Set your hourly rate
							</button>
						) : (
							statusLine && (
								<p className="text-[13px] text-muted-foreground">
									{statusLine}
								</p>
							)
						)}
					</div>
				</div>

				{rates?.availability && (
					<p className="mt-3 text-[13px] text-muted-foreground">
						{formatAvailability(rates.availability)}
					</p>
				)}

				<p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
					{note}
				</p>
				{cta}

				{joinedLabel && (
					<p className="mt-4 text-center text-[13px] text-muted-foreground">
						Member since {joinedLabel}
					</p>
				)}
			</div>
		</>
	);
}
