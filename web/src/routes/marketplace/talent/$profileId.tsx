import { createFileRoute, Link } from "@tanstack/react-router";
import {
	BadgeCheck,
	Camera,
	MapPin,
	MessageCircle,
	Plus,
	User,
	UserPlus,
	X,
} from "lucide-react";
import { useState } from "react";
import { ConsultantExperience } from "@/components/marketplace/consultant/ConsultantExperience";
import { ConsultantServices } from "@/components/marketplace/consultant/ConsultantServices";
import { ConsultantSkills } from "@/components/marketplace/consultant/ConsultantSkills";
import { MarketplaceCategoryBar } from "@/components/marketplace/home/MarketplaceCategoryBar";
import { InviteModal } from "@/components/marketplace/InviteModal";
import { MarketplaceFooter } from "@/components/marketplace/MarketplaceFooter";
import { SectionEditButton } from "@/components/marketplace/profile/EditableSection";
import {
	EngagePanel,
	RAIL_BUTTON_CLASS,
	RAIL_CTA_CLASS,
} from "@/components/marketplace/profile/EngagePanel";
import { MessageSellerButton } from "@/components/marketplace/profile/MessageSellerButton";
import { SellerAbout } from "@/components/marketplace/profile/SellerAbout";
import { SellerAvatar } from "@/components/marketplace/profile/SellerAvatar";
import { SellerPortfolio } from "@/components/marketplace/profile/SellerPortfolio";
import { useSellerProfileEditor } from "@/components/marketplace/profile/useSellerProfileEditor";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { usePublicServiceOfferingsByUserQuery } from "@/hooks/useServiceOfferings";
import { useTalentProfileQuery } from "@/hooks/useTalent";
import { isActiveConsultant } from "@/lib/auth-utils";
import type { TalentPublicSpecialization } from "@/queries/talent";
import { useAuthStore } from "@/stores/authStore";

export const Route = createFileRoute("/marketplace/talent/$profileId")({
	component: TalentProfile,
});

/**
 * The public talent profile — the talent twin of
 * /marketplace/consultant/$profileId, in the same prose-flat layout with the
 * engage panel as the one bordered surface.
 *
 * Public on purpose: the endpoint only serves ACTIVE listings (paused = 404),
 * so everything on this page is something the talent chose to publish. The
 * page renders no rating and no review count — nothing writes `user_stats`,
 * and an invented 0.0 is the most damaging lie a marketplace page can tell.
 *
 * WYSIWYG for the owner: this page IS the editor. Every section carries a
 * pencil opening the same modals the private profile uses; the private
 * /profile page remains the account editor for payouts, KYC and contact info.
 */
function TalentProfile() {
	const { profileId } = Route.useParams();
	const { user } = useAuthStore();
	const isOwner = user?.id === profileId;
	const {
		data: profile,
		isLoading,
		error,
	} = useTalentProfileQuery(profileId, { noStore: isOwner });
	const { data: services = [] } =
		usePublicServiceOfferingsByUserQuery(profileId);
	// The viewer's own profile — only to decide whether the consultant-only
	// "Invite to project" secondary CTA renders.
	const { data: viewerProfile } = useProfileQuery();
	const editor = useSellerProfileEditor(profileId, isOwner);
	const [inviteOpen, setInviteOpen] = useState(false);

	if (isLoading) return <ProfileSkeleton />;
	if (error || !profile) return <ProfileNotFound />;

	const name = profile.display_name?.trim() || "Talent";
	const initial = name.charAt(0).toUpperCase();
	const location = [profile.city, profile.country].filter(Boolean).join(", ");
	const specializations = profile.specializations ?? [];
	const skills = profile.skills ?? [];
	const languages = profile.languages ?? [];
	const experiences = profile.experiences ?? [];
	const portfolios = profile.portfolios ?? [];
	const viewerCanInvite = !isOwner && isActiveConsultant(viewerProfile);

	return (
		<div className="min-h-screen bg-background pt-app-header">
			<MarketplaceCategoryBar />

			<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
				<div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
					<div className="min-w-0">
						<div className="flex items-start gap-6">
							{isOwner ? (
								<button
									type="button"
									onClick={editor.openAvatar}
									aria-label="Change profile photo"
									className="group relative shrink-0 cursor-pointer rounded-full"
								>
									<SellerAvatar
										name={name}
										initial={initial}
										url={profile.avatar_url}
										className="h-24 w-24 text-3xl"
									/>
									<span className="absolute inset-0 flex items-center justify-center rounded-full bg-foreground/50 opacity-0 transition-opacity group-hover:opacity-100">
										<Camera className="h-6 w-6 text-background" />
									</span>
								</button>
							) : (
								<SellerAvatar
									name={name}
									initial={initial}
									url={profile.avatar_url}
									className="h-24 w-24 shrink-0 text-3xl"
								/>
							)}

							<div className="min-w-0 pt-1">
								<div className="flex flex-wrap items-center gap-2">
									<h1 className="text-2xl font-bold text-foreground">{name}</h1>
									{/* Unconditional: the endpoint 404s anyone not actively
									    listed, so a rendered page IS an open-to-work page. */}
									<span className="inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-700 dark:text-emerald-400">
										<BadgeCheck className="h-4 w-4 shrink-0" />
										Open to work
									</span>
									{isOwner && (
										<SectionEditButton
											label="Edit headline"
											onClick={editor.openHeader}
										/>
									)}
								</div>

								{profile.headline ? (
									<p className="mt-2 text-[17px] font-medium text-foreground">
										{profile.headline}
									</p>
								) : (
									isOwner && (
										<button
											type="button"
											onClick={editor.openHeader}
											className="mt-2 cursor-pointer text-left text-[14px] text-muted-foreground hover:text-foreground"
										>
											Add a headline — it is the one line clients read first.
										</button>
									)
								)}

								<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-muted-foreground">
									{location && (
										<span className="inline-flex items-center gap-1.5">
											<MapPin className="h-4 w-4 shrink-0" />
											{location}
										</span>
									)}
									{languages.length > 0 && (
										<span className="inline-flex items-center gap-1.5">
											<MessageCircle className="h-4 w-4 shrink-0" />
											{languages.map((entry) => entry.name).join(", ")}
										</span>
									)}
									{isOwner && (
										<button
											type="button"
											onClick={editor.addLanguage}
											className="inline-flex cursor-pointer items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
										>
											<Plus className="h-3.5 w-3.5" />
											{languages.length > 0 ? "Add language" : "Add languages"}
										</button>
									)}
								</div>
							</div>
						</div>

						<h2 className="mt-8 text-[15px] font-bold text-foreground">
							About me
							{isOwner && (
								<SectionEditButton
									label="Edit about"
									onClick={editor.openAbout}
								/>
							)}
						</h2>
						<SellerAbout
							bio={profile.bio}
							isOwner={isOwner}
							emptyOwnerCopy="You have not written an overview yet. Describe the work you do and the outcomes clients get."
							emptyVisitorCopy={`${name} has not written an overview yet.`}
						/>

						<h2 className="mt-8 text-[15px] font-bold text-foreground">
							Specializations
							{isOwner && (
								<SectionEditButton
									label="Add specialization"
									onClick={editor.addSpecialization}
								/>
							)}
						</h2>
						<Specializations
							specializations={specializations}
							isOwner={isOwner}
							onEdit={isOwner ? editor.editSpecialization : undefined}
							onDelete={isOwner ? editor.deleteSpecialization : undefined}
						/>

						{(skills.length > 0 || isOwner) && (
							<>
								<h2 className="mt-8 text-[15px] font-bold text-foreground">
									Skills
									{isOwner && (
										<SectionEditButton
											label="Edit skills"
											onClick={editor.openAbout}
										/>
									)}
								</h2>
								<ConsultantSkills skills={skills} isOwner={isOwner} />
							</>
						)}

						{(services.length > 0 || isOwner) && (
							<>
								<h2 className="mt-10 text-[19px] font-bold text-foreground">
									See my services
								</h2>
								<ConsultantServices
									services={services}
									isOwner={isOwner}
									name={name}
								/>
							</>
						)}

						<h2 className="mt-10 text-[19px] font-bold text-foreground">
							Portfolio
							{isOwner && (
								<SectionEditButton
									label="Add portfolio item"
									onClick={editor.addPortfolio}
								/>
							)}
						</h2>
						<SellerPortfolio
							portfolios={portfolios}
							isOwner={isOwner}
							name={name}
							onEditItem={isOwner ? editor.editPortfolio : undefined}
							onDeleteItem={
								isOwner ? (item) => editor.deletePortfolio(item.id) : undefined
							}
						/>

						{(experiences.length > 0 || isOwner) && (
							<>
								<h2 className="mt-10 text-[19px] font-bold text-foreground">
									Work experience
									{isOwner && (
										<SectionEditButton
											label="Add work experience"
											onClick={editor.addExperience}
										/>
									)}
								</h2>
								<ConsultantExperience
									experiences={experiences}
									isOwner={isOwner}
									name={name}
									onEditItem={isOwner ? editor.editExperience : undefined}
									onDeleteItem={
										isOwner
											? (entry) => editor.deleteExperience(entry.id)
											: undefined
									}
								/>
							</>
						)}

						<h2 className="mt-10 text-[15px] font-bold text-foreground">
							Reviews
						</h2>
						<p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
							Client feedback appears here once {name} has completed work on
							Proyekto. It is recorded from signed contracts and accepted
							deliverables rather than self-reported, which is why there is no
							rating on this page yet.
						</p>
					</div>

					<div className="lg:sticky lg:top-20 lg:self-start">
						<EngagePanel
							name={name}
							initial={initial}
							avatarUrl={profile.avatar_url}
							rates={profile.rates ?? null}
							statusLine="Open to work"
							createdAt={profile.created_at ?? null}
							onEditRates={isOwner ? editor.openRates : undefined}
							topLinks={
								isOwner ? (
									<>
										<Link
											to="/marketplace/talent/settings"
											className={RAIL_BUTTON_CLASS}
										>
											Talent settings
										</Link>
										<Link
											to="/profile/$profileId"
											params={{ profileId }}
											className={RAIL_BUTTON_CLASS}
										>
											Account settings
										</Link>
									</>
								) : (
									<>
										<Link to="/start-selling" className={RAIL_BUTTON_CLASS}>
											Start selling
										</Link>
										<Link to="/marketplace" className={RAIL_BUTTON_CLASS}>
											Marketplace
										</Link>
									</>
								)
							}
							note={
								isOwner
									? "This is your public profile — and your editor. What you change here is exactly what clients and consultants see."
									: `Talk first, then work under a signed contract — scope, rates and dates are agreed before anything starts.`
							}
							cta={
								isOwner ? (
									<Link to="/engagements" className={RAIL_CTA_CLASS}>
										Your contracts
									</Link>
								) : (
									<>
										<MessageSellerButton
											sellerId={profileId}
											sellerName={name}
											redirectTo={`/marketplace/talent/${profileId}`}
											className={`${RAIL_CTA_CLASS} gap-2`}
										/>
										{viewerCanInvite && (
											<button
												type="button"
												onClick={() => setInviteOpen(true)}
												className="mt-2 inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-border text-[14px] font-medium text-foreground transition-colors hover:bg-muted"
											>
												<UserPlus className="h-4 w-4" />
												Invite to project
											</button>
										)}
									</>
								)
							}
						/>
					</div>
				</div>
			</div>

			<MarketplaceFooter />
			{editor.modals}
			{viewerCanInvite && (
				<InviteModal
					open={inviteOpen}
					onClose={() => setInviteOpen(false)}
					inviteeId={profileId}
					inviteeName={name}
				/>
			)}
		</div>
	);
}

/**
 * Self-declared focus areas — plain chips, not links: unlike consultant
 * expertise there is no taxonomy page behind them. `category` is a snake_case
 * enum, prettified here because this is the only public surface it renders on.
 */
function Specializations({
	specializations,
	isOwner,
	onEdit,
	onDelete,
}: {
	specializations: TalentPublicSpecialization[];
	isOwner: boolean;
	onEdit?: (entry: TalentPublicSpecialization) => void;
	onDelete?: (id: string) => void;
}) {
	if (specializations.length === 0) {
		return (
			<p className="mt-3 text-[15px] text-muted-foreground">
				{isOwner
					? "Add the industries and problem spaces you know best — clients filter by them."
					: "No specializations listed yet."}
			</p>
		);
	}

	return (
		<div className="mt-3 flex flex-wrap gap-2">
			{specializations.map((entry) => {
				const label = entry.subCategory
					? `${prettify(entry.category)} · ${entry.subCategory}`
					: prettify(entry.category);
				if (!onEdit) {
					return (
						<span
							key={entry.id}
							title={entry.description ?? undefined}
							className="rounded-full border border-border px-4 py-1.5 text-[14px] text-foreground"
						>
							{label}
						</span>
					);
				}
				return (
					<span
						key={entry.id}
						className="inline-flex items-center gap-1 rounded-full border border-border py-1.5 pl-4 pr-2 text-[14px] text-foreground"
					>
						<button
							type="button"
							onClick={() => onEdit(entry)}
							title="Edit specialization"
							className="cursor-pointer hover:text-primary"
						>
							{label}
						</button>
						{onDelete && (
							<button
								type="button"
								aria-label={`Remove ${label}`}
								onClick={() => onDelete(entry.id)}
								className="cursor-pointer rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
							>
								<X className="h-3.5 w-3.5" />
							</button>
						)}
					</span>
				);
			})}
		</div>
	);
}

function prettify(value: string): string {
	return value
		.split("_")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

function ProfileSkeleton() {
	return (
		<div className="min-h-screen bg-background pt-app-header">
			<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
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
				Talent profile not available
			</h1>
			<p className="mt-1 max-w-sm text-center text-[14px] text-muted-foreground">
				This listing may have been removed or paused by its owner.
			</p>
			<Link
				to="/marketplace"
				className="mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-foreground px-6 text-[14px] font-semibold text-background transition-opacity hover:opacity-90"
			>
				Back to the marketplace
			</Link>
		</div>
	);
}
