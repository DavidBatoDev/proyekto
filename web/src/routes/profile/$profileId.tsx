import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
	Award,
	BadgeCheck,
	BookOpen,
	Briefcase,
	Building2,
	Camera,
	Check,
	Clock,
	DollarSign,
	Edit2,
	ExternalLink,
	Globe,
	GraduationCap,
	ImagePlus,
	LayoutGrid,
	Loader2,
	Mail,
	MapPin,
	Phone,
	Plus,
	ShieldCheck,
	Star,
	Trash2,
	User,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AboutModal } from "@/components/profile/AboutModal";
import { CertificationModal } from "@/components/profile/CertificationModal";
import { EducationModal } from "@/components/profile/EducationModal";
import { ExperienceModal } from "@/components/profile/ExperienceModal";
import { HeaderModal } from "@/components/profile/HeaderModal";
import { IdentityDocumentModal } from "@/components/profile/IdentityDocumentModal";
import { LanguageModal } from "@/components/profile/LanguageModal";
import { LicenseModal } from "@/components/profile/LicenseModal";
import { PayoutMethodsSection } from "@/components/profile/PayoutMethodsSection";
import { PortfolioModal } from "@/components/profile/PortfolioModal";
import {
	AvailabilityBadge,
	ProfileCard as Card,
	EmptyProfileBanner,
	ProfileEmptyState as EmptyState,
	ExpandableText,
	IconButton,
	InlineField,
	MetaRow,
	PillButton,
	ProficiencyDot,
	ProfileSectionHeader,
} from "@/components/profile/ProfileUi";
import { SpecializationModal } from "@/components/profile/SpecializationModal";
import { UploadModal } from "@/components/profile/UploadModal";
import { useToast } from "@/hooks/useToast";
import {
	type FullProfile,
	type ProficiencyLevel,
	profileService,
	type TalentRequirement,
	type UpdateProfileData,
	type UserCertification,
	type UserEducation,
	type UserExperience,
	type UserLanguage,
	type UserLicense,
	type UserPortfolio,
	type UserSpecialization,
} from "@/services/profile.service";
import { uploadService } from "@/services/upload.service";
import { useAuthStore } from "@/stores/authStore";

// ─────────────────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/profile/$profileId")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) throw redirect({ to: "/auth/login" });
	},
	component: ProfilePage,
});

const profileKeys = { full: (id: string) => ["full-profile", id] as const };

/**
 * `satisfies` rather than a bare `as const`: this map is indexed by
 * TalentRequirement, and a plain object is allowed to be a SUPERSET of the
 * union. It carried a dead `identity` key for exactly that reason after the
 * requirement was dropped -- nothing failed, it just quietly described a rule
 * that no longer existed. This way the next divergence is a build error.
 */
const TALENT_REQUIREMENT_LABELS = {
	rate_settings: "Rate and availability",
	portfolio: "Portfolio item",
	profile_basics: "Headline, bio, and country",
} satisfies Record<TalentRequirement, string>;

// ─── Utilities ────────────────────────────────────────────────────────────────
function fmtDate(iso: string | null | undefined) {
	if (!iso) return "";
	const d = new Date(iso);
	return d.toLocaleDateString("en-US", { year: "numeric", month: "short" });
}

function initials(name: string) {
	return name
		.split(" ")
		.map((w) => w[0])
		.join("")
		.slice(0, 2)
		.toUpperCase();
}

// ─── Section header ───────────────────────────────────────────────────────────
/**
 * A thin wrapper over the shared header so the twelve call sites keep reading
 * as "title, icon, can I add to it" rather than assembling an action node each.
 */
function SectionTitle({
	title,
	icon: Icon,
	isOwner,
	onAdd,
	count,
}: {
	title: string;
	icon: React.ElementType;
	isOwner: boolean;
	onAdd?: () => void;
	count?: number;
}) {
	return (
		<ProfileSectionHeader
			title={title}
			icon={Icon}
			count={count}
			className="mb-4"
			action={
				isOwner && onAdd ? (
					<IconButton label={`Add ${title}`} onClick={onAdd}>
						<Plus className="h-4 w-4" />
					</IconButton>
				) : undefined
			}
		/>
	);
}

// ─── Main page ────────────────────────────────────────────────────────────────
function ProfilePage() {
	const { profileId } = Route.useParams();
	const { user } = useAuthStore();
	const isOwner = user?.id === profileId;
	const qc = useQueryClient();
	const toast = useToast();

	const {
		data: profile,
		isLoading,
		error,
	} = useQuery({
		queryKey: profileKeys.full(profileId),
		queryFn: () => profileService.getProfile(profileId),
		enabled: !!profileId,
	});

	const { data: talentEligibility } = useQuery({
		queryKey: ["talentGoLiveEligibility", profileId],
		queryFn: () => profileService.getGoLiveEligibility(),
		enabled: isOwner && !!profile && profile.talent_status === null,
	});

	// ── Mutations ─────────────────────────────────────────────────────────────
	const updateMutation = useMutation({
		mutationFn: (data: UpdateProfileData) => profileService.updateProfile(data),
		onSuccess: (updated) => {
			qc.setQueryData<FullProfile>(profileKeys.full(profileId), (old) =>
				old ? { ...old, ...updated } : old,
			);
			setEditSection(null);
			setHeaderModalOpen(false);
		},
	});

	const pauseTalent = useMutation({
		mutationFn: () => profileService.pause(),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: profileKeys.full(profileId) });
			void qc.invalidateQueries({
				queryKey: ["talentGoLiveEligibility", profileId],
			});
			toast.success("Your talent profile is paused.");
		},
		onError: () => toast.error("Unable to pause your talent profile."),
	});

	const resumeTalent = useMutation({
		mutationFn: () => profileService.goLive(),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: profileKeys.full(profileId) });
			toast.success("Your talent profile is live again.");
		},
		onError: () =>
			toast.error("Complete the eligibility checklist before resuming."),
	});

	const addEducation = useMutation({
		mutationFn: profileService.addEducation.bind(profileService),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) });
			setEduModalOpen(false);
		},
	});
	const deleteEducation = useMutation({
		mutationFn: profileService.deleteEducation.bind(profileService),
		onSuccess: () =>
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) }),
	});
	const updateEducation = useMutation({
		mutationFn: ({ id, payload }: { id: string; payload: any }) =>
			profileService.updateEducation(id, payload),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) });
			setEduModalOpen(false);
			setEditingEdu(null);
		},
	});

	const addExperience = useMutation({
		mutationFn: profileService.addExperience.bind(profileService),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) });
			setExpModalOpen(false);
		},
	});
	const deleteExperience = useMutation({
		mutationFn: profileService.deleteExperience.bind(profileService),
		onSuccess: () =>
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) }),
	});
	const updateExperience = useMutation({
		mutationFn: ({ id, payload }: { id: string; payload: any }) =>
			profileService.updateExperience(id, payload),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) });
			setExpModalOpen(false);
			setEditingExp(null);
		},
	});

	const addCertification = useMutation({
		mutationFn: profileService.addCertification.bind(profileService),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) });
			setCertModalOpen(false);
		},
	});
	const deleteCertification = useMutation({
		mutationFn: profileService.deleteCertification.bind(profileService),
		onSuccess: () =>
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) }),
	});
	const updateCertification = useMutation({
		mutationFn: ({ id, payload }: { id: string; payload: any }) =>
			profileService.updateCertification(id, payload),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) });
			setCertModalOpen(false);
			setEditingCert(null);
		},
	});

	const addPortfolio = useMutation({
		mutationFn: profileService.addPortfolio.bind(profileService),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) });
			setPortModalOpen(false);
		},
	});
	const deletePortfolio = useMutation({
		mutationFn: profileService.deletePortfolio.bind(profileService),
		onSuccess: () =>
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) }),
	});
	const updatePortfolio = useMutation({
		mutationFn: ({ id, payload }: { id: string; payload: any }) =>
			profileService.updatePortfolio(id, payload),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) });
			setPortModalOpen(false);
			setEditingPort(null);
		},
	});

	const addLanguage = useMutation({
		mutationFn: profileService.addLanguage.bind(profileService),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) });
			setLangModalOpen(false);
		},
	});
	const deleteLanguage = useMutation({
		mutationFn: profileService.deleteLanguage.bind(profileService),
		onSuccess: () =>
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) }),
	});
	const updateLanguage = useMutation({
		mutationFn: ({ id, payload }: { id: string; payload: any }) =>
			profileService.updateLanguage(id, payload),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) });
			setLangModalOpen(false);
			setEditingLang(null);
		},
	});

	const addSpecialization = useMutation({
		mutationFn: profileService.addSpecialization.bind(profileService),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) });
			setSpecModalOpen(false);
		},
	});
	const deleteSpecialization = useMutation({
		mutationFn: profileService.deleteSpecialization.bind(profileService),
		onSuccess: () =>
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) }),
	});
	const updateSpecialization = useMutation({
		mutationFn: ({ id, payload }: { id: string; payload: any }) =>
			profileService.updateSpecialization(id, payload),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) });
			setSpecModalOpen(false);
			setEditingSpec(null);
		},
	});

	const addLicense = useMutation({
		mutationFn: profileService.addLicense.bind(profileService),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) });
			setLicModalOpen(false);
		},
	});
	const deleteLicense = useMutation({
		mutationFn: profileService.deleteLicense.bind(profileService),
		onSuccess: () =>
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) }),
	});
	const updateLicense = useMutation({
		mutationFn: ({ id, payload }: { id: string; payload: any }) =>
			profileService.updateLicense(id, payload),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) });
			setLicModalOpen(false);
			setEditingLic(null);
		},
	});

	const addIdentityDoc = useMutation({
		mutationFn: async ({ payload, file }: { payload: any; file: File }) => {
			// 1. Upload to private storage
			const storage_path = await uploadService.upload(
				"identity_documents" as any,
				file,
			);
			// 2. Persist to DB
			return profileService.addIdentityDocument({ ...payload, storage_path });
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) });
			setIdDocModalOpen(false);
		},
	});
	const deleteIdentityDoc = useMutation({
		mutationFn: profileService.deleteIdentityDocument.bind(profileService),
		onSuccess: () =>
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) }),
	});

	const metaQuery = useQuery({
		queryKey: ["profileMeta"],
		queryFn: async () => {
			const [skills, languages] = await Promise.all([
				profileService.getAllSkills(),
				profileService.getAllLanguages(),
			]);
			return { skills, languages };
		},
		staleTime: 1000 * 60 * 60, // 1 hour
	});

	// ── ALL state (must be before early returns) ──────────────────────────────
	type EditSection = "bio" | "contact" | "rate";
	const [editSection, setEditSection] = useState<EditSection | null>(null);
	const [contactForm, setContactForm] = useState({
		phone_number: "",
		country: "",
		city: "",
		zip_code: "",
	});
	const [rateForm, setRateForm] = useState({
		hourly_rate: "",
		currency: "USD",
		availability: "available",
	});

	const [eduModalOpen, setEduModalOpen] = useState(false);
	const [expModalOpen, setExpModalOpen] = useState(false);
	const [certModalOpen, setCertModalOpen] = useState(false);
	const [portModalOpen, setPortModalOpen] = useState(false);
	const [aboutModalOpen, setAboutModalOpen] = useState(false);
	const [langModalOpen, setLangModalOpen] = useState(false);
	const [specModalOpen, setSpecModalOpen] = useState(false);
	const [licModalOpen, setLicModalOpen] = useState(false);
	const [idDocModalOpen, setIdDocModalOpen] = useState(false);
	const [headerModalOpen, setHeaderModalOpen] = useState(false);

	// Which existing item is being edited (null = add mode)
	const [editingExp, setEditingExp] = useState<UserExperience | null>(null);
	const [editingEdu, setEditingEdu] = useState<UserEducation | null>(null);
	const [editingCert, setEditingCert] = useState<UserCertification | null>(
		null,
	);
	const [editingPort, setEditingPort] = useState<UserPortfolio | null>(null);
	const [editingLang, setEditingLang] = useState<UserLanguage | null>(null);
	const [editingSpec, setEditingSpec] = useState<UserSpecialization | null>(
		null,
	);
	const [editingLic, setEditingLic] = useState<UserLicense | null>(null);

	// Upload states — must live ABOVE all early returns
	const [avatarModalOpen, setAvatarModalOpen] = useState(false);
	const [bannerModalOpen, setBannerModalOpen] = useState(false);
	const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
	const [isUploadingBanner, setIsUploadingBanner] = useState(false);

	useEffect(() => {
		if (!profile) return;
		setContactForm({
			phone_number: profile.phone_number ?? "",
			country: profile.country ?? "",
			city: profile.city ?? "",
			zip_code: profile.zip_code ?? "",
		});
		setRateForm({
			hourly_rate: String(profile.rate_settings?.hourly_rate ?? ""),
			currency: profile.rate_settings?.currency ?? "USD",
			availability: profile.rate_settings?.availability ?? "available",
		});
	}, [profile]);

	// ── About (bio + skills) combined save ──────────────────────────────────────────
	const [isAboutSaving, setIsAboutSaving] = useState(false);

	const handleAboutSave = async (
		bio: string,
		skills: Array<{ skill_id: string; proficiency_level: ProficiencyLevel }>,
	) => {
		setIsAboutSaving(true);
		try {
			const [updatedProfile, updatedSkills] = await Promise.all([
				profileService.updateProfile({ bio }),
				profileService.updateSkills(
					skills.map(({ skill_id, proficiency_level }) => ({
						skill_id,
						proficiency_level,
					})),
				),
			]);
			qc.setQueryData<FullProfile>(profileKeys.full(profileId), (old) =>
				old ? { ...old, ...updatedProfile, skills: updatedSkills } : old,
			);
			qc.invalidateQueries({ queryKey: profileKeys.full(profileId) });
			setAboutModalOpen(false);
		} catch {
			toast.error("Failed to save changes. Please try again.");
		} finally {
			setIsAboutSaving(false);
		}
	};

	// ── Helpers ───────────────────────────────────────────────────────────────
	const isEditing = (s: EditSection) => editSection === s;
	const cancelEdit = () => setEditSection(null);
	const saveContact = () => updateMutation.mutate(contactForm);
	const saveRate = async () => {
		await profileService.updateRateSettings({
			hourly_rate: Number(rateForm.hourly_rate) || null,
			currency: rateForm.currency,
			availability: rateForm.availability as any,
		});
		qc.invalidateQueries({ queryKey: profileKeys.full(profileId) });
		cancelEdit();
	};

	const handleAvatarUpload = async (files: File[]) => {
		if (!files[0]) return;
		setIsUploadingAvatar(true);
		try {
			const url = await uploadService.uploadAvatar(files[0]);
			qc.setQueryData<FullProfile>(profileKeys.full(profileId), (old) =>
				old ? { ...old, avatar_url: url } : old,
			);
			setAvatarModalOpen(false);
		} catch (e) {
			console.error("Avatar upload failed", e);
		} finally {
			setIsUploadingAvatar(false);
		}
	};

	const handleBannerUpload = async (files: File[]) => {
		if (!files[0]) return;
		setIsUploadingBanner(true);
		try {
			const url = await uploadService.uploadBanner(files[0]);
			qc.setQueryData<FullProfile>(profileKeys.full(profileId), (old) =>
				old ? { ...old, banner_url: url } : old,
			);
			setBannerModalOpen(false);
		} catch (e) {
			console.error("Banner upload failed", e);
		} finally {
			setIsUploadingBanner(false);
		}
	};

	// ── Early returns ─────────────────────────────────────────────────────────
	if (isLoading)
		return (
			<div className="min-h-screen bg-background text-foreground flex items-center justify-center">
				<Loader2 className="w-10 h-10 animate-spin text-primary" />
			</div>
		);
	if (error || !profile)
		return (
			<>
				<div className="min-h-screen bg-background text-foreground flex items-center justify-center pt-20">
					<div className="text-center bg-card p-12 rounded-2xl border border-border max-w-sm">
						<User className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
						<h2 className="text-lg font-bold text-foreground mb-1">
							Profile not found
						</h2>
						<p className="text-sm text-muted-foreground">
							This profile doesn't exist or you don't have permission to view
							it.
						</p>
					</div>
				</div>
			</>
		);

	const fullName =
		profile.display_name ||
		`${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() ||
		"User";
	const initial = initials(fullName);

	// ─── RENDER ────────────────────────────────────────────────────────────────
	return (
		<>
			<div className="min-h-screen bg-background pb-20 pt-app-header text-foreground">
				<div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
					{/* ══ HEADER CARD (banner + avatar overlap, LinkedIn-style) ═══════ */}
					<Card className="mb-5 overflow-visible">
						<div className="relative h-40 w-full overflow-hidden rounded-t-2xl bg-muted sm:h-52">
							{profile.banner_url ? (
								<img
									src={profile.banner_url}
									alt="Banner"
									className="h-full w-full object-cover"
								/>
							) : (
								<EmptyProfileBanner
									isOwner={isOwner}
									onAdd={() => setBannerModalOpen(true)}
								/>
							)}
							{/* The corner control stays for the "replace what is there"
							    case; the empty state carries its own. */}
							{isOwner && profile.banner_url && (
								<button
									onClick={() => setBannerModalOpen(true)}
									className="absolute bottom-3 right-3 flex items-center gap-1.5 text-xs font-medium bg-black/50 hover:bg-black/70 text-white px-3 py-1.5 rounded-full backdrop-blur-sm transition-colors"
								>
									<ImagePlus className="h-3.5 w-3.5" />
									Change banner
								</button>
							)}
						</div>

						{/* Avatar (overlaps banner) */}
						<div className="px-5 pb-6 sm:px-8">
							<div className="-mt-14 mb-4 flex flex-col gap-4 sm:-mt-16 sm:flex-row sm:items-end sm:justify-between">
								{/* Avatar */}
								<div className="relative shrink-0 self-start">
									{profile.avatar_url ? (
										<img
											src={profile.avatar_url}
											alt={fullName}
											className="w-28 h-28 sm:w-32 sm:h-32 rounded-full object-cover border-4 border-white shadow-md"
										/>
									) : (
										<div className="w-28 h-28 sm:w-32 sm:h-32 rounded-full border-4 border-white shadow-md bg-primary flex items-center justify-center text-primary-foreground text-3xl font-bold">
											{initial}
										</div>
									)}
									{isOwner && (
										<button
											onClick={() => setAvatarModalOpen(true)}
											title="Change photo"
											className="absolute bottom-1 right-1 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card shadow transition-colors hover:bg-muted"
										>
											<Camera className="h-4 w-4 text-muted-foreground" />
										</button>
									)}
								</div>

								{/* Owner actions, aligned to the bottom of the avatar row */}
								{isOwner && (
									<div className="flex flex-wrap items-center gap-2 pb-1 sm:justify-end">
										{profile.talent_status === null && (
											<Link
												to="/marketplace/talent/go-live"
												className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
											>
												Offer your services
											</Link>
										)}
										{profile.talent_status === "active" && (
											<PillButton
												onClick={() => pauseTalent.mutate()}
												disabled={pauseTalent.isPending}
											>
												{pauseTalent.isPending
													? "Pausing…"
													: "Pause marketplace listing"}
											</PillButton>
										)}
										{profile.talent_status === "paused" && (
											<PillButton
												variant="primary"
												onClick={() => resumeTalent.mutate()}
												disabled={resumeTalent.isPending}
											>
												{resumeTalent.isPending
													? "Resuming…"
													: "Resume listing"}
											</PillButton>
										)}
										<PillButton onClick={() => setHeaderModalOpen(true)}>
											<Edit2 className="h-3.5 w-3.5" />
											Edit profile
										</PillButton>
									</div>
								)}
							</div>

							{/* Name & headline */}
							<div>
								<div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
									<h1 className="text-[26px] font-bold leading-tight tracking-tight text-foreground">
										{fullName}
									</h1>
									{profile.is_consultant_verified && (
										<span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11.5px] font-semibold text-primary">
											<BadgeCheck className="h-3.5 w-3.5" />
											Verified consultant
										</span>
									)}
									{profile.talent_status === "active" && (
										<span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400">
											<span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
											Open to work
										</span>
									)}
								</div>

								{profile.headline && (
									<p className="mt-1.5 max-w-2xl text-[14.5px] leading-snug text-muted-foreground">
										{profile.headline}
									</p>
								)}

								{/*
								 * One meta line rather than three stacked ones: location,
								 * rate and how long they have been here are all "who is
								 * this", and reading them as a row is what makes the header
								 * scan like a profile instead of a form.
								 */}
								<div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-muted-foreground">
									{(profile.city || profile.country) && (
										<span className="inline-flex items-center gap-1.5">
											<MapPin className="h-3.5 w-3.5" />
											{[profile.city, profile.country]
												.filter(Boolean)
												.join(", ")}
										</span>
									)}
									{profile.rate_settings?.hourly_rate != null && (
										<span className="inline-flex items-center gap-1.5">
											<DollarSign className="h-3.5 w-3.5" />
											{profile.rate_settings.hourly_rate}{" "}
											{profile.rate_settings.currency}/hr
										</span>
									)}
									{profile.languages.length > 0 && (
										<span className="inline-flex items-center gap-1.5">
											<Globe className="h-3.5 w-3.5" />
											{profile.languages
												.slice(0, 3)
												.map((language) => language.language.name)
												.join(", ")}
										</span>
									)}
									<span className="inline-flex items-center gap-1.5">
										<Clock className="h-3.5 w-3.5" />
										Joined {fmtDate(profile.created_at)}
									</span>
								</div>
							</div>

							{/*
							 * What is still missing before this profile can be listed.
							 * Rendered as the requirements themselves rather than a
							 * percentage: "add a portfolio item" is something somebody can
							 * act on, where "68% complete" is a number to feel bad about.
							 */}
							{isOwner &&
								profile.talent_status === null &&
								talentEligibility &&
								!talentEligibility.eligible && (
									<div className="mt-5 rounded-xl border border-border bg-muted/40 px-4 py-3">
										<p className="text-[12.5px] font-semibold text-foreground">
											Before you can be listed in the marketplace
										</p>
										<ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
											{talentEligibility.missing.map((item) => (
												<li
													key={item}
													className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground"
												>
													<span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
													{TALENT_REQUIREMENT_LABELS[item]}
												</li>
											))}
										</ul>
									</div>
								)}
						</div>
					</Card>

					{/* ══ ACCOUNT TYPE SECTION (owner only) ════════════════════════ */}
					{/* ══ 2-COLUMN LAYOUT ════════════════════════════════════════════ */}
					<div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
						{/*
						 * The rail sticks on desktop: it is reference material (how to
						 * reach them, what they charge, what they speak) that stays
						 * relevant while somebody reads eleven roles of history.
						 */}
						<div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
							{/* Contact */}
							<Card className="p-5">
								<div className="flex items-center justify-between mb-3">
									<h3 className="text-[13.5px] font-semibold text-foreground">
										Contact Info
									</h3>
									{isOwner && !isEditing("contact") && (
										<IconButton
											label="Edit contact info"
											onClick={() => setEditSection("contact")}
										>
											<Edit2 className="h-3.5 w-3.5" />
										</IconButton>
									)}
								</div>
								{isEditing("contact") ? (
									<div className="space-y-3">
										<InlineField
											label="Email"
											name="email"
											value={profile.email ?? ""}
											readOnly
										/>
										<InlineField
											label="Phone"
											name="phone_number"
											value={contactForm.phone_number}
											onChange={(e) =>
												setContactForm((p) => ({
													...p,
													phone_number: e.target.value,
												}))
											}
										/>
										<InlineField
											label="City"
											name="city"
											value={contactForm.city}
											onChange={(e) =>
												setContactForm((p) => ({ ...p, city: e.target.value }))
											}
										/>
										<InlineField
											label="Country"
											name="country"
											value={contactForm.country}
											onChange={(e) =>
												setContactForm((p) => ({
													...p,
													country: e.target.value,
												}))
											}
										/>
										<InlineField
											label="Zip / Postal Code"
											name="zip_code"
											value={contactForm.zip_code}
											onChange={(e) =>
												setContactForm((p) => ({
													...p,
													zip_code: e.target.value,
												}))
											}
										/>
										<div className="flex gap-2 pt-1">
											<button
												onClick={saveContact}
												disabled={updateMutation.isPending}
												className="flex-1 py-1.5 bg-primary text-primary-foreground text-sm font-semibold rounded-full hover:bg-primary/90 disabled:opacity-60 flex items-center justify-center gap-1"
											>
												{updateMutation.isPending ? (
													<Loader2 className="w-3.5 h-3.5 animate-spin" />
												) : (
													<Check className="w-3.5 h-3.5" />
												)}{" "}
												Save
											</button>
											<button
												onClick={cancelEdit}
												className="flex-1 py-1.5 border border-border text-muted-foreground text-sm rounded-full hover:bg-muted"
											>
												Cancel
											</button>
										</div>
									</div>
								) : (
									<div className="space-y-3">
										{profile.email && (
											<MetaRow icon={Mail}>
												<span className="break-all">{profile.email}</span>
											</MetaRow>
										)}
										{profile.phone_number && (
											<MetaRow icon={Phone}>
												<span className="flex flex-wrap items-center gap-1.5">
													{profile.phone_number}
													<span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-600 dark:text-amber-400">
														Unverified
													</span>
												</span>
											</MetaRow>
										)}
										{[profile.city, profile.country]
											.filter(Boolean)
											.join(", ") && (
											<MetaRow icon={MapPin}>
												{[profile.city, profile.country]
													.filter(Boolean)
													.join(", ")}
											</MetaRow>
										)}
										{!profile.email &&
											!profile.phone_number &&
											!profile.city && (
												<p className="text-[12.5px] text-muted-foreground">
													No contact info added.
												</p>
											)}
									</div>
								)}
							</Card>

							{/* Rate & Availability */}
							<Card className="p-5">
								<div className="flex items-center justify-between mb-3">
									<h3 className="text-[13.5px] font-semibold text-foreground">
										Rate &amp; Availability
									</h3>
									{isOwner && !isEditing("rate") && (
										<IconButton
											label="Edit rate and availability"
											onClick={() => setEditSection("rate")}
										>
											<Edit2 className="h-3.5 w-3.5" />
										</IconButton>
									)}
								</div>
								{isEditing("rate") ? (
									<div className="space-y-3">
										<InlineField
											label="Hourly Rate"
											name="hourly_rate"
											value={rateForm.hourly_rate}
											onChange={(e) =>
												setRateForm((p) => ({
													...p,
													hourly_rate: e.target.value,
												}))
											}
										/>
										<div>
											<label className="block text-xs font-medium text-muted-foreground mb-1">
												Currency
											</label>
											<select
												value={rateForm.currency}
												onChange={(e) =>
													setRateForm((p) => ({
														...p,
														currency: e.target.value,
													}))
												}
												className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
											>
												{["USD", "EUR", "GBP", "PHP", "AUD", "CAD"].map((c) => (
													<option key={c}>{c}</option>
												))}
											</select>
										</div>
										<div>
											<label className="block text-xs font-medium text-muted-foreground mb-1">
												Availability
											</label>
											<select
												value={rateForm.availability}
												onChange={(e) =>
													setRateForm((p) => ({
														...p,
														availability: e.target.value,
													}))
												}
												className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
											>
												<option value="available">Available</option>
												<option value="partially_available">
													Partially Available
												</option>
												<option value="unavailable">Unavailable</option>
											</select>
										</div>
										<div className="flex gap-2 pt-1">
											<button
												onClick={saveRate}
												className="flex-1 py-1.5 bg-primary text-primary-foreground text-sm font-semibold rounded-full hover:bg-primary/90 flex items-center justify-center gap-1"
											>
												<Check className="w-3.5 h-3.5" /> Save
											</button>
											<button
												onClick={cancelEdit}
												className="flex-1 py-1.5 border border-border text-muted-foreground text-sm rounded-full hover:bg-muted"
											>
												Cancel
											</button>
										</div>
									</div>
								) : (
									<div className="space-y-2">
										{profile.rate_settings?.hourly_rate ? (
											<div className="flex items-center gap-2">
												<DollarSign className="w-4 h-4 text-muted-foreground" />
												<span className="text-sm font-semibold text-foreground">
													{profile.rate_settings.hourly_rate}{" "}
													{profile.rate_settings.currency}
													<span className="font-normal text-muted-foreground">
														/hr
													</span>
												</span>
											</div>
										) : isOwner ? (
											<p className="text-xs text-muted-foreground italic">
												Set your rate
											</p>
										) : null}
										{profile.rate_settings?.availability && (
											<AvailabilityBadge
												status={profile.rate_settings.availability}
											/>
										)}
									</div>
								)}
							</Card>

							{/* Languages */}
							<Card className="p-5">
								<div className="flex items-center justify-between mb-3">
									<h3 className="text-[13.5px] font-semibold text-foreground">
										Languages
									</h3>
									{isOwner && (
										<IconButton
											label="Add language"
											onClick={() => setLangModalOpen(true)}
										>
											<Plus className="h-3.5 w-3.5" />
										</IconButton>
									)}
								</div>
								{profile.languages.length > 0 ? (
									<div className="space-y-4">
										{profile.languages.map((l) => (
											<div
												key={l.id}
												className="flex items-center justify-between group"
											>
												<div className="flex items-center gap-2">
													<Globe className="w-4 h-4 text-muted-foreground shrink-0" />
													<div className="flex flex-col">
														<span className="text-sm font-semibold text-foreground">
															{l.language.name}
														</span>
														<span className="text-xs text-muted-foreground capitalize">
															{l.fluency_level}
														</span>
													</div>
												</div>
												{isOwner && (
													<div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
														<button
															onClick={() => {
																setEditingLang(l);
																setLangModalOpen(true);
															}}
															className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
															title="Edit"
														>
															<Edit2 className="w-3.5 h-3.5" />
														</button>
														<button
															onClick={() => deleteLanguage.mutate(l.id)}
															disabled={deleteLanguage.isPending}
															className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
															title="Delete"
														>
															{deleteLanguage.isPending ? (
																<Loader2 className="w-3.5 h-3.5 animate-spin" />
															) : (
																<Trash2 className="w-3.5 h-3.5" />
															)}
														</button>
													</div>
												)}
											</div>
										))}
									</div>
								) : (
									<EmptyState
										message="No languages added."
										actionLabel={isOwner ? "Add a language" : undefined}
										onAction={
											isOwner ? () => setLangModalOpen(true) : undefined
										}
									/>
								)}
							</Card>

							{/* Stats */}
							{profile.stats && (
								<Card className="p-5">
									<h3 className="mb-3 text-[13.5px] font-semibold text-foreground">
										Stats
									</h3>
									<div className="grid grid-cols-2 gap-3">
										{[
											{
												icon: Star,
												label: "Rating",
												val: profile.stats.avg_rating?.toFixed(1) ?? "—",
											},
											{
												icon: Briefcase,
												label: "Completed",
												val: profile.stats.jobs_completed ?? 0,
											},
											{
												icon: Clock,
												label: "On-time",
												val: profile.stats.on_time_rate
													? `${Math.round(profile.stats.on_time_rate * 100)}%`
													: "—",
											},
											{
												icon: DollarSign,
												label: "Earned",
												val: profile.stats.total_earnings
													? `$${(profile.stats.total_earnings / 100).toFixed(0)}`
													: "—",
											},
										].map(({ icon: Icon, label, val }) => (
											<div
												key={label}
												className="flex flex-col items-center p-2 bg-muted rounded-xl"
											>
												<Icon className="w-4 h-4 text-primary mb-1" />
												<span className="text-sm font-bold text-foreground">
													{val}
												</span>
												<span className="text-xs text-muted-foreground">
													{label}
												</span>
											</div>
										))}
									</div>
								</Card>
							)}
							{/* Identity Documents (KYC/KYB) - Only visible to owner/admins */}
							{isOwner && (
								<Card className="p-5 border-[#14b8a6]/20 bg-teal-50/10">
									<div className="flex items-center justify-between mb-3 border-b border-[#14b8a6]/10 pb-2">
										<h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-foreground">
											<ShieldCheck className="w-4 h-4 text-[#14b8a6]" />
											Verification Documents
										</h3>
										<button
											onClick={() => setIdDocModalOpen(true)}
											className="p-1.5 rounded-full border border-border text-muted-foreground hover:bg-card transition-colors"
										>
											<Plus className="w-3.5 h-3.5" />
										</button>
									</div>
									{profile.identity_documents?.length > 0 ? (
										<div className="space-y-3">
											{profile.identity_documents.map((doc) => (
												<div
													key={doc.id}
													className="flex items-center justify-between group bg-card p-2.5 rounded-xl border border-border shadow-sm"
												>
													<div className="flex items-center gap-3">
														<div
															className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${doc.is_verified ? "bg-green-100" : "bg-muted"}`}
														>
															{doc.is_verified ? (
																<Check className="w-4 h-4 text-green-600" />
															) : (
																<Loader2 className="w-4 h-4 text-muted-foreground" />
															)}
														</div>
														<div className="flex flex-col">
															<span className="text-sm font-semibold text-foreground capitalize">
																{doc.type.replace("_", " ")}
															</span>
															<span className="text-xs text-muted-foreground">
																{doc.is_verified
																	? "Verified"
																	: "Pending review"}
																{doc.uploaded_at &&
																	` • Uploaded ${new Date(doc.uploaded_at).toLocaleDateString()}`}
															</span>
														</div>
													</div>
													<button
														onClick={() => deleteIdentityDoc.mutate(doc.id)}
														disabled={deleteIdentityDoc.isPending}
														className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
														title="Delete Document"
													>
														{deleteIdentityDoc.isPending ? (
															<Loader2 className="w-3.5 h-3.5 animate-spin" />
														) : (
															<Trash2 className="w-3.5 h-3.5" />
														)}
													</button>
												</div>
											))}
										</div>
									) : (
										<EmptyState
											message="No identity documents provided."
											actionLabel={isOwner ? "Upload a document" : undefined}
											onAction={
												isOwner ? () => setIdDocModalOpen(true) : undefined
											}
										/>
									)}
								</Card>
							)}
						</div>

						{/* RIGHT MAIN CONTENT */}
						<div className="space-y-5">
							{/* ── About & Skills (merged card) ─────────────────────────── */}
							<Card className="p-6">
								<ProfileSectionHeader
									title="About"
									icon={User}
									className="mb-4"
									action={
										isOwner ? (
											<IconButton
												label="Edit about and skills"
												onClick={() => setAboutModalOpen(true)}
											>
												<Edit2 className="h-3.5 w-3.5" />
											</IconButton>
										) : undefined
									}
								/>

								{/* Bio */}
								{profile.bio ? (
									<div className="mb-5">
										<ExpandableText text={profile.bio} lines={6} />
									</div>
								) : isOwner ? (
									<button
										onClick={() => setAboutModalOpen(true)}
										className="block w-full text-left text-sm text-muted-foreground italic mb-5 hover:text-primary transition-colors"
									>
										+ Add a professional summary…
									</button>
								) : (
									<p className="text-sm text-muted-foreground italic mb-5">
										No overview provided.
									</p>
								)}

								{/* Divider */}
								{(profile.bio ||
									profile.skills.length > 0 ||
									profile.specializations.length > 0) && (
									<hr className="mb-5 border-border" />
								)}

								{/* Specializations */}
								<div className="mb-3 flex items-center justify-between">
									<h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
										Specializations
									</h3>
									{isOwner && (
										<button
											onClick={() => setSpecModalOpen(true)}
											className="text-xs text-primary font-semibold hover:underline flex items-center gap-0.5"
										>
											<Plus className="w-3 h-3" /> Add specialization
										</button>
									)}
								</div>
								{profile.specializations.length > 0 ? (
									<div className="space-y-4 mb-6">
										{profile.specializations.map((s) => (
											<div
												key={s.id}
												className="group relative rounded-xl border border-border bg-muted/30 p-3 pr-12"
											>
												<div className="flex items-center gap-2 mb-1">
													<span className="font-semibold text-foreground text-sm capitalize">
														{s.category.replace("_", " ")}
													</span>
													{s.years_of_experience && (
														<span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
															{s.years_of_experience} yrs
														</span>
													)}
												</div>
												{s.sub_category && (
													<p className="text-xs font-medium text-muted-foreground mb-1">
														{s.sub_category}
													</p>
												)}
												{s.description && (
													<p className="text-sm text-muted-foreground line-clamp-2">
														{s.description}
													</p>
												)}
												{isOwner && (
													<div className="absolute right-0 top-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
														<button
															onClick={() => {
																setEditingSpec(s);
																setSpecModalOpen(true);
															}}
															className="p-1 text-muted-foreground hover:text-primary"
															title="Edit"
														>
															<Edit2 className="w-3.5 h-3.5" />
														</button>
														<button
															onClick={() => deleteSpecialization.mutate(s.id)}
															className="p-1 text-muted-foreground hover:text-destructive"
															title="Delete"
														>
															{deleteSpecialization.isPending ? (
																<Loader2 className="w-3.5 h-3.5 animate-spin" />
															) : (
																<Trash2 className="w-3.5 h-3.5" />
															)}
														</button>
													</div>
												)}
											</div>
										))}
									</div>
								) : (
									<EmptyState
										message="No specializations added."
										actionLabel={isOwner ? "Add a specialization" : undefined}
										onAction={
											isOwner ? () => setSpecModalOpen(true) : undefined
										}
									/>
								)}

								{/* Skills */}
								<div className="mb-3 mt-6 flex items-center justify-between">
									<h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
										Skills
									</h3>
									{isOwner && profile.skills.length === 0 && (
										<button
											onClick={() => setAboutModalOpen(true)}
											className="text-xs text-primary font-semibold hover:underline flex items-center gap-0.5"
										>
											<Plus className="w-3 h-3" /> Add skills
										</button>
									)}
								</div>
								{profile.skills.length > 0 ? (
									<div className="flex flex-wrap gap-2">
										{profile.skills.map((s) => (
											<span
												key={s.id}
												className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[13px] text-foreground"
											>
												{s.skill.name}
												<ProficiencyDot level={s.proficiency_level} />
											</span>
										))}
									</div>
								) : (
									<EmptyState
										message="No skills added yet."
										actionLabel={isOwner ? "Add skills" : undefined}
										onAction={
											isOwner ? () => setAboutModalOpen(true) : undefined
										}
									/>
								)}
							</Card>

							{/* Work Experience — roadmap/timeline style */}
							<Card className="p-6">
								<SectionTitle
									title="Experience"
									icon={Briefcase}
									isOwner={isOwner}
									onAdd={() => setExpModalOpen(true)}
								/>
								{profile.experiences.length > 0 ? (
									<div className="relative">
										{/* Vertical timeline line */}
										<div className="absolute left-[18px] top-2 bottom-2 w-px bg-border" />
										<div className="space-y-0">
											{profile.experiences.map((exp) => {
												const start = fmtDate(exp.start_date);
												const end = exp.is_current
													? "Present"
													: fmtDate(exp.end_date);
												return (
													<div
														key={exp.id}
														className="relative flex items-start gap-4 pl-10 pb-7 last:pb-0 group"
													>
														{/* Node dot */}
														<div className="absolute left-0 top-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
															<Building2 className="h-4 w-4 text-muted-foreground" />
														</div>
														{/* Content */}
														<div className="flex-1 min-w-0">
															<div className="flex items-start justify-between gap-2">
																<div>
																	<p className="font-bold text-foreground text-sm leading-tight">
																		{exp.title}
																	</p>
																	<p className="text-muted-foreground text-sm">
																		{exp.company}
																	</p>
																	<p className="text-muted-foreground text-xs mt-0.5">
																		{start} – {end}
																		{exp.location &&
																			!exp.is_remote &&
																			` · ${exp.location}`}
																		{exp.is_remote && " · Remote"}
																	</p>
																</div>
																{isOwner && (
																	<div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
																		<button
																			onClick={() => {
																				setEditingExp(exp);
																				setExpModalOpen(true);
																			}}
																			className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
																			title="Edit"
																		>
																			<Edit2 className="w-3.5 h-3.5" />
																		</button>
																		<button
																			onClick={() =>
																				deleteExperience.mutate(exp.id)
																			}
																			disabled={deleteExperience.isPending}
																			className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
																		>
																			{deleteExperience.isPending ? (
																				<Loader2 className="w-3.5 h-3.5 animate-spin" />
																			) : (
																				<Trash2 className="w-3.5 h-3.5" />
																			)}
																		</button>
																	</div>
																)}
															</div>
															{exp.description && (
																<div className="mt-2">
																	<ExpandableText
																		text={exp.description}
																		lines={3}
																	/>
																</div>
															)}
														</div>
													</div>
												);
											})}
										</div>
									</div>
								) : (
									<EmptyState
										message="No work experience added."
										actionLabel={isOwner ? "Add a role" : undefined}
										onAction={isOwner ? () => setExpModalOpen(true) : undefined}
									/>
								)}
							</Card>

							{/* Education */}
							<Card className="p-6">
								<SectionTitle
									title="Education"
									icon={GraduationCap}
									isOwner={isOwner}
									onAdd={() => setEduModalOpen(true)}
								/>
								{profile.educations.length > 0 ? (
									<div className="divide-y divide-border">
										{profile.educations.map((edu) => (
											<div
												key={edu.id}
												className="py-4 flex items-start gap-4 group first:pt-0 last:pb-0"
											>
												{/* Bold black icon */}
												<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
													<BookOpen
														className="w-5 h-5 text-foreground"
														strokeWidth={2.5}
													/>
												</div>
												<div className="flex-1 min-w-0">
													<p className="font-bold text-foreground text-sm">
														{edu.institution}
													</p>
													<p className="text-muted-foreground text-sm">
														{[edu.degree, edu.field_of_study]
															.filter(Boolean)
															.join(" · ")}
													</p>
													{(edu.start_year || edu.end_year) && (
														<p className="text-muted-foreground text-xs mt-0.5">
															{edu.start_year && `${edu.start_year}`}
															{edu.end_year &&
																` – ${edu.is_current ? "Present" : edu.end_year}`}
														</p>
													)}
													{edu.description && (
														<p className="text-muted-foreground text-xs mt-1">
															{edu.description}
														</p>
													)}
												</div>
												{isOwner && (
													<div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
														<button
															onClick={() => {
																setEditingEdu(edu);
																setEduModalOpen(true);
															}}
															className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
															title="Edit"
														>
															<Edit2 className="w-3.5 h-3.5" />
														</button>
														<button
															onClick={() => deleteEducation.mutate(edu.id)}
															disabled={deleteEducation.isPending}
															className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
														>
															{deleteEducation.isPending ? (
																<Loader2 className="w-3.5 h-3.5 animate-spin" />
															) : (
																<Trash2 className="w-3.5 h-3.5" />
															)}
														</button>
													</div>
												)}
											</div>
										))}
									</div>
								) : (
									<EmptyState
										message="No education added."
										actionLabel={isOwner ? "Add education" : undefined}
										onAction={isOwner ? () => setEduModalOpen(true) : undefined}
									/>
								)}
							</Card>

							{/* Certifications */}
							<Card className="p-6">
								<SectionTitle
									title="Licenses &amp; Certifications"
									icon={ShieldCheck}
									isOwner={isOwner}
									onAdd={() => setCertModalOpen(true)}
								/>
								{profile.certifications.length > 0 ? (
									<div className="divide-y divide-border">
										{profile.certifications.map((cert) => (
											<div
												key={cert.id}
												className="py-4 flex items-start gap-4 group first:pt-0 last:pb-0"
											>
												<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
													<Award
														className="w-5 h-5 text-foreground"
														strokeWidth={2.5}
													/>
												</div>
												<div className="flex-1 min-w-0">
													<div className="flex items-center gap-1.5">
														<p className="font-bold text-foreground text-sm">
															{cert.name}
														</p>
														{cert.is_verified && (
															<BadgeCheck className="w-3.5 h-3.5 text-green-600" />
														)}
													</div>
													<p className="text-muted-foreground text-sm">
														{cert.issuer}
													</p>
													<div className="flex flex-wrap items-center gap-3 mt-0.5">
														{cert.issue_date && (
															<p className="text-muted-foreground text-xs">
																Issued {fmtDate(cert.issue_date)}
															</p>
														)}
														{cert.credential_id && (
															<p className="text-muted-foreground text-xs">
																ID: {cert.credential_id}
															</p>
														)}
													</div>
													{cert.credential_url && (
														<a
															href={cert.credential_url}
															target="_blank"
															rel="noopener noreferrer"
															className="inline-flex items-center gap-1 mt-1.5 text-xs border border-border text-muted-foreground px-3 py-1 rounded-full hover:bg-muted transition-colors"
														>
															<ExternalLink className="w-3 h-3" /> Show
															credential
														</a>
													)}
												</div>
												{isOwner && (
													<div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
														<button
															onClick={() => {
																setEditingCert(cert);
																setCertModalOpen(true);
															}}
															className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
															title="Edit"
														>
															<Edit2 className="w-3.5 h-3.5" />
														</button>
														<button
															onClick={() =>
																deleteCertification.mutate(cert.id)
															}
															disabled={deleteCertification.isPending}
															className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
														>
															{deleteCertification.isPending ? (
																<Loader2 className="w-3.5 h-3.5 animate-spin" />
															) : (
																<Trash2 className="w-3.5 h-3.5" />
															)}
														</button>
													</div>
												)}
											</div>
										))}
									</div>
								) : (
									<EmptyState
										message="No certifications added."
										actionLabel={isOwner ? "Add a certification" : undefined}
										onAction={
											isOwner ? () => setCertModalOpen(true) : undefined
										}
									/>
								)}
							</Card>

							{/* Licenses */}
							<Card className="p-6">
								<SectionTitle
									title="Licenses"
									icon={BadgeCheck}
									isOwner={isOwner}
									onAdd={() => setLicModalOpen(true)}
								/>
								{profile.licenses.length > 0 ? (
									<div className="space-y-4">
										{profile.licenses.map((lic) => (
											<div key={lic.id} className="group relative flex gap-3">
												<div className="mt-1 w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
													<ShieldCheck className="w-5 h-5 text-indigo-500" />
												</div>
												<div className="flex-1">
													<h4 className="text-sm font-bold text-foreground">
														{lic.name}
													</h4>
													<p className="text-sm text-muted-foreground mb-1">
														{lic.issuing_authority}
													</p>
													<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
														{lic.issue_date && (
															<span>Issued: {fmtDate(lic.issue_date)}</span>
														)}
														{lic.expiry_date && (
															<span>Expires: {fmtDate(lic.expiry_date)}</span>
														)}
														{lic.license_number && (
															<span>ID: {lic.license_number}</span>
														)}
													</div>
												</div>
												{isOwner && (
													<div className="absolute top-0 right-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
														<button
															onClick={() => {
																setEditingLic(lic);
																setLicModalOpen(true);
															}}
															className="p-1 hover:text-primary text-muted-foreground transition-colors"
														>
															<Edit2 className="w-3.5 h-3.5" />
														</button>
														<button
															onClick={() => deleteLicense.mutate(lic.id)}
															className="p-1 hover:text-destructive text-muted-foreground transition-colors"
														>
															{deleteLicense.isPending ? (
																<Loader2 className="w-3.5 h-3.5 animate-spin" />
															) : (
																<Trash2 className="w-3.5 h-3.5" />
															)}
														</button>
													</div>
												)}
											</div>
										))}
									</div>
								) : (
									<EmptyState
										message="No licenses added."
										actionLabel={isOwner ? "Add a license" : undefined}
										onAction={isOwner ? () => setLicModalOpen(true) : undefined}
									/>
								)}
							</Card>

							{/* Portfolio */}
							{(profile.portfolios.length > 0 || isOwner) && (
								<Card className="p-6">
									<SectionTitle
										title="Portfolio"
										icon={LayoutGrid}
										isOwner={isOwner}
										onAdd={() => setPortModalOpen(true)}
									/>
									{profile.portfolios.length > 0 ? (
										<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
											{profile.portfolios.map((item) => (
												<div
													key={item.id}
													className="group relative border border-border rounded-xl overflow-hidden hover:shadow-md transition-shadow"
												>
													{item.image_url ? (
														<img
															src={item.image_url}
															alt={item.title}
															className="w-full aspect-video object-cover"
														/>
													) : (
														<div className="w-full aspect-video bg-muted flex items-center justify-center">
															<LayoutGrid className="w-8 h-8 text-muted-foreground" />
														</div>
													)}
													<div className="p-3">
														<p className="font-semibold text-foreground text-sm">
															{item.title}
														</p>
														{item.description && (
															<p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
																{item.description}
															</p>
														)}
														{item.url && (
															<a
																href={item.url}
																target="_blank"
																rel="noopener noreferrer"
																className="inline-flex items-center gap-1 mt-1.5 text-xs text-primary hover:underline"
															>
																<ExternalLink className="w-3 h-3" /> View
																project
															</a>
														)}
														{item.tags.length > 0 && (
															<div className="flex flex-wrap gap-1 mt-2">
																{item.tags.map((t) => (
																	<span
																		key={t}
																		className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full"
																	>
																		{t}
																	</span>
																))}
															</div>
														)}
													</div>
													{isOwner && (
														<div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
															<button
																onClick={() => {
																	setEditingPort(item);
																	setPortModalOpen(true);
																}}
																className="p-1.5 bg-card/90 border border-border rounded-lg text-muted-foreground hover:text-primary shadow-sm transition-colors"
																title="Edit"
															>
																<Edit2 className="w-3.5 h-3.5" />
															</button>
															<button
																onClick={() => deletePortfolio.mutate(item.id)}
																disabled={deletePortfolio.isPending}
																className="p-1.5 bg-card/90 border border-border rounded-lg text-muted-foreground hover:text-destructive shadow-sm transition-colors"
															>
																{deletePortfolio.isPending ? (
																	<Loader2 className="w-3.5 h-3.5 animate-spin" />
																) : (
																	<Trash2 className="w-3.5 h-3.5" />
																)}
															</button>
														</div>
													)}
												</div>
											))}
										</div>
									) : (
										<EmptyState
											message="No portfolio items added."
											actionLabel={isOwner ? "Add a portfolio item" : undefined}
											onAction={
												isOwner ? () => setPortModalOpen(true) : undefined
											}
										/>
									)}
								</Card>
							)}

							{/* Payout methods (own profile only) */}
							{isOwner && <PayoutMethodsSection />}
						</div>
					</div>
				</div>
			</div>

			{/* ══ MODALS ══════════════════════════════════════════════════════════ */}
			<HeaderModal
				isOpen={headerModalOpen}
				onClose={() => setHeaderModalOpen(false)}
				onSave={(payload) => updateMutation.mutate(payload)}
				isSaving={updateMutation.isPending}
				firstName={profile.first_name ?? ""}
				lastName={profile.last_name ?? ""}
				headline={profile.headline ?? ""}
			/>
			<AboutModal
				isOpen={aboutModalOpen}
				onClose={() => setAboutModalOpen(false)}
				initialBio={profile.bio ?? ""}
				currentSkills={profile.skills}
				onSave={handleAboutSave}
				isSaving={isAboutSaving}
			/>
			<ExperienceModal
				isOpen={expModalOpen}
				onClose={() => {
					setExpModalOpen(false);
					setEditingExp(null);
				}}
				initialData={editingExp ?? undefined}
				onSave={(payload) => {
					if (editingExp)
						updateExperience.mutate({ id: editingExp.id, payload });
					else addExperience.mutate(payload as any);
				}}
				isSaving={
					editingExp ? updateExperience.isPending : addExperience.isPending
				}
			/>
			<EducationModal
				isOpen={eduModalOpen}
				onClose={() => {
					setEduModalOpen(false);
					setEditingEdu(null);
				}}
				initialData={editingEdu ?? undefined}
				onSave={(payload) => {
					if (editingEdu)
						updateEducation.mutate({ id: editingEdu.id, payload });
					else addEducation.mutate(payload as any);
				}}
				isSaving={
					editingEdu ? updateEducation.isPending : addEducation.isPending
				}
			/>
			<CertificationModal
				isOpen={certModalOpen}
				onClose={() => {
					setCertModalOpen(false);
					setEditingCert(null);
				}}
				initialData={editingCert ?? undefined}
				onSave={(payload) => {
					if (editingCert)
						updateCertification.mutate({ id: editingCert.id, payload });
					else addCertification.mutate(payload as any);
				}}
				isSaving={
					editingCert
						? updateCertification.isPending
						: addCertification.isPending
				}
			/>
			<PortfolioModal
				isOpen={portModalOpen}
				onClose={() => {
					setPortModalOpen(false);
					setEditingPort(null);
				}}
				initialData={editingPort ?? undefined}
				onSave={(payload) => {
					if (editingPort)
						updatePortfolio.mutate({ id: editingPort.id, payload });
					else addPortfolio.mutate(payload as any);
				}}
				isSaving={
					editingPort ? updatePortfolio.isPending : addPortfolio.isPending
				}
				nextPosition={profile.portfolios.length}
			/>
			<SpecializationModal
				isOpen={specModalOpen}
				onClose={() => {
					setSpecModalOpen(false);
					setEditingSpec(null);
				}}
				initialData={editingSpec ?? undefined}
				onSave={(payload) => {
					if (editingSpec)
						updateSpecialization.mutate({ id: editingSpec.id, payload });
					else addSpecialization.mutate(payload as any);
				}}
				isSaving={
					editingSpec
						? updateSpecialization.isPending
						: addSpecialization.isPending
				}
			/>
			<LicenseModal
				isOpen={licModalOpen}
				onClose={() => {
					setLicModalOpen(false);
					setEditingLic(null);
				}}
				initialData={editingLic ?? undefined}
				onSave={(payload) => {
					if (editingLic) updateLicense.mutate({ id: editingLic.id, payload });
					else addLicense.mutate(payload as any);
				}}
				isSaving={editingLic ? updateLicense.isPending : addLicense.isPending}
			/>
			<LanguageModal
				isOpen={langModalOpen}
				onClose={() => {
					setLangModalOpen(false);
					setEditingLang(null);
				}}
				initialData={editingLang ?? undefined}
				languagesMeta={metaQuery.data?.languages ?? []}
				onSave={(payload) => {
					if (editingLang)
						updateLanguage.mutate({ id: editingLang.id, payload });
					else addLanguage.mutate(payload as any);
				}}
				isSaving={
					editingLang ? updateLanguage.isPending : addLanguage.isPending
				}
			/>
			<IdentityDocumentModal
				isOpen={idDocModalOpen}
				onClose={() => setIdDocModalOpen(false)}
				onSave={(payload, file) => addIdentityDoc.mutate({ payload, file })}
				isSaving={addIdentityDoc.isPending}
			/>
			<UploadModal
				isOpen={avatarModalOpen}
				onClose={() => setAvatarModalOpen(false)}
				title="Update Profile Photo"
				accept="image/jpeg,image/png,image/webp,image/gif"
				maxFiles={1}
				maxSizeMb={5}
				aspectHint="1:1 (square recommended)"
				onUpload={handleAvatarUpload}
				isUploading={isUploadingAvatar}
			/>
			<UploadModal
				isOpen={bannerModalOpen}
				onClose={() => setBannerModalOpen(false)}
				title="Update Banner Photo"
				accept="image/jpeg,image/png,image/webp"
				maxFiles={1}
				maxSizeMb={10}
				aspectHint="4:1 (wide landscape)"
				onUpload={handleBannerUpload}
				isUploading={isUploadingBanner}
			/>
		</>
	);
}
