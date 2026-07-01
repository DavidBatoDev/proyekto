import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/useToast";
import { useAuthStore } from "@/stores/authStore";
import {
  profileService,
  type FullProfile,
  type UpdateProfileData,
  type UserExperience,
  type UserEducation,
  type UserCertification,
  type UserPortfolio,
  type UserLanguage,
  type UserSpecialization,
  type UserLicense,
  type ProficiencyLevel,
  applicationService,
} from "@/services/profile.service";
import { uploadService } from "@/services/upload.service";
import { EducationModal } from "@/components/profile/EducationModal";
import { ExperienceModal } from "@/components/profile/ExperienceModal";
import { CertificationModal } from "@/components/profile/CertificationModal";
import { PortfolioModal } from "@/components/profile/PortfolioModal";
import { UploadModal } from "@/components/profile/UploadModal";
import { AboutModal } from "@/components/profile/AboutModal";
import { LanguageModal } from "@/components/profile/LanguageModal";
import { SpecializationModal } from "@/components/profile/SpecializationModal";
import { LicenseModal } from "@/components/profile/LicenseModal";
import { IdentityDocumentModal } from "@/components/profile/IdentityDocumentModal";
import { AccountTypeSection } from "@/components/profile/AccountTypeSection";
import { PayoutMethodsSection } from "@/components/profile/PayoutMethodsSection";
import {
  User,
  Camera,
  BadgeCheck,
  MapPin,
  Edit2,
  Plus,
  Trash2,
  Briefcase,
  GraduationCap,
  Award,
  Globe,
  Star,
  DollarSign,
  Check,
  Loader2,
  ExternalLink,
  ImagePlus,
  Phone,
  Mail,
  Clock,
  Building2,
  BookOpen,
  ShieldCheck,
  LayoutGrid,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/profile/$profileId")({
  beforeLoad: () => {
    const { isAuthenticated } = useAuthStore.getState();
    if (!isAuthenticated) throw redirect({ to: "/auth/login" });
  },
  component: ProfilePage,
});

const profileKeys = { full: (id: string) => ["full-profile", id] as const };

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

// ─── Tiny shared UI ────────────────────────────────────────────────────────────
function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white border border-gray-200 rounded-2xl ${className}`}>
      {children}
    </div>
  );
}

function SectionTitle({
  title,
  icon: Icon,
  isOwner,
  onAdd,
}: {
  title: string;
  icon: React.ElementType;
  isOwner: boolean;
  onAdd?: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <Icon className="w-5 h-5 text-gray-900" strokeWidth={2.5} />
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      </div>
      <div className="flex items-center gap-2">
        {isOwner && onAdd && (
          <button
            onClick={onAdd}
            className="p-1.5 rounded-full hover:bg-gray-100 text-gray-500 transition-colors"
            title={`Add ${title}`}
          >
            <Plus className="w-4 h-4" strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="text-sm text-gray-400 italic py-2">{message}</p>;
}

function ProficiencyDot({ level }: { level: string }) {
  const map: Record<string, { color: string; label: string }> = {
    beginner: { color: "bg-gray-300", label: "Beginner" },
    intermediate: { color: "bg-amber-400", label: "Intermediate" },
    advanced: { color: "bg-orange-500", label: "Advanced" },
    expert: { color: "bg-green-600", label: "Expert" },
  };
  const { color, label } = map[level] ?? { color: "bg-gray-300", label: level };
  return (
    <span className="flex items-center gap-1 text-xs text-gray-500">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

// ─── Inline field (used for editable sections that stay inline) ────────────────
function InlineField({
  label,
  name,
  value,
  onChange,
  multiline = false,
  readOnly = false,
}: {
  label: string;
  name: string;
  value: string;
  onChange?: (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
  multiline?: boolean;
  readOnly?: boolean;
}) {
  const base = "w-full px-3 py-2 border rounded-lg text-sm focus:outline-none";
  const editable = `${base} border-gray-300 focus:ring-2 focus:ring-[#ff9933]/50`;
  const ro = `${base} border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed`;
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">
        {label}
        {readOnly && (
          <span className="ml-1 font-normal text-gray-400">(read-only)</span>
        )}
      </label>
      {multiline ? (
        <textarea
          name={name}
          value={value}
          onChange={onChange}
          rows={4}
          className={editable}
          readOnly={readOnly}
        />
      ) : (
        <input
          type="text"
          name={name}
          value={value}
          onChange={onChange}
          className={readOnly ? ro : editable}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}

// ─── Availability badge ───────────────────────────────────────────────────────
function AvailabilityBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    available: { label: "Available", cls: "bg-green-100 text-green-700" },
    partially_available: {
      label: "Partial",
      cls: "bg-amber-100 text-amber-700",
    },
    unavailable: { label: "Unavailable", cls: "bg-red-100 text-red-700" },
  };
  const { label, cls } = map[status] ?? {
    label: status,
    cls: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${cls}`}>
      {label}
    </span>
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

  const { data: existingApp, isLoading: appLoading } = useQuery({
    queryKey: ["myApplication"],
    queryFn: () => applicationService.getMyApplication(),
    enabled: isOwner,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: (data: UpdateProfileData) => profileService.updateProfile(data),
    onSuccess: (updated) => {
      qc.setQueryData<FullProfile>(profileKeys.full(profileId), (old) =>
        old ? { ...old, ...updated } : old,
      );
      setEditSection(null);
    },
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
  type EditSection = "header" | "bio" | "contact" | "rate";
  const [editSection, setEditSection] = useState<EditSection | null>(null);
  const [headerForm, setHeaderForm] = useState({ headline: "" });
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
    setHeaderForm({ headline: profile.headline ?? "" });
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
          skills.map(({ skill_id, proficiency_level }) => ({ skill_id, proficiency_level })),
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
  const saveHeader = () =>
    updateMutation.mutate({ headline: headerForm.headline });
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
      <div className="min-h-screen bg-[#f3f2ee] flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-[#ff9933]" />
      </div>
    );
  if (error || !profile)
    return (
      <>
        <div className="min-h-screen bg-[#f3f2ee] flex items-center justify-center pt-20">
          <div className="text-center bg-white p-12 rounded-2xl border border-gray-200 max-w-sm">
            <User className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <h2 className="text-lg font-bold text-gray-800 mb-1">
              Profile not found
            </h2>
            <p className="text-sm text-gray-500">
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
      <div className="min-h-screen bg-[#f3f2ee] pt-[72px] pb-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          {/* ══ HEADER CARD (banner + avatar overlap, LinkedIn-style) ═══════ */}
          <Card className="mb-3 overflow-visible">
            {/* Banner */}
            <div className="relative w-full h-36 sm:h-48 rounded-t-2xl overflow-hidden bg-linear-to-br from-gray-800 via-gray-700 to-gray-900">
              {profile.banner_url && (
                <img
                  src={profile.banner_url}
                  alt="Banner"
                  className="w-full h-full object-cover"
                />
              )}
              {isOwner && (
                <button
                  onClick={() => setBannerModalOpen(true)}
                  className="absolute bottom-3 right-3 flex items-center gap-1.5 text-xs font-medium bg-black/50 hover:bg-black/70 text-white px-3 py-1.5 rounded-full backdrop-blur-sm transition-colors"
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  {profile.banner_url ? "Change banner" : "Add banner"}
                </button>
              )}
            </div>

            {/* Avatar (overlaps banner) */}
            <div className="px-6 sm:px-8 pb-5">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 -mt-14 sm:-mt-16 mb-3">
                {/* Avatar */}
                <div className="relative shrink-0 self-start">
                  {profile.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt={fullName}
                      className="w-28 h-28 sm:w-32 sm:h-32 rounded-full object-cover border-4 border-white shadow-md"
                    />
                  ) : (
                    <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-full border-4 border-white shadow-md bg-[#ff9933] flex items-center justify-center text-white text-3xl font-bold">
                      {initial}
                    </div>
                  )}
                  {isOwner && (
                    <button
                      onClick={() => setAvatarModalOpen(true)}
                      title="Change photo"
                      className="absolute bottom-1 right-1 w-8 h-8 bg-white border border-gray-300 rounded-full flex items-center justify-center shadow hover:bg-gray-50 transition-colors"
                    >
                      <Camera className="w-4 h-4 text-gray-600" />
                    </button>
                  )}
                </div>

                {/* Action buttons (top-right, aligned to bottom of avatar row) */}
                {isOwner && (
                  <div className="flex items-center gap-2 pb-1">
                    {/* Apply as Consultant CTA — only shown when not yet verified */}
                    {!profile.is_consultant_verified && !appLoading && (
                      <>
                        <Link
                          to="/consultant/apply"
                          className="text-sm font-semibold bg-teal-50 border border-teal-400 text-teal-600 px-4 py-1.5 rounded-full hover:bg-teal-100 transition-colors flex items-center gap-1.5"
                        >
                          {existingApp && existingApp.status !== "draft"
                            ? "View Application Status"
                            : "Apply as Consultant"}
                        </Link>
                        <Link
                          to="/freelancer/go-live"
                          className="text-sm font-semibold border border-[#ff9933] text-[#ff9933] px-4 py-1.5 rounded-full hover:bg-[#ff9933]/5 transition-colors"
                        >
                          I Want to Work
                        </Link>
                      </>
                    )}
                    <Link
                      to="/consultant/$profileId"
                      params={{ profileId }}
                      className="text-sm font-semibold border border-[#ff9933] text-[#ff9933] px-4 py-1.5 rounded-full hover:bg-[#ff9933]/5 transition-colors"
                    >
                      Public view
                    </Link>
                    <button
                      onClick={() =>
                        setEditSection(isEditing("header") ? null : "header")
                      }
                      className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 transition-colors"
                      title="Edit profile"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Name & headline */}
              {isEditing("header") ? (
                <div className="max-w-lg space-y-3 mt-1">
                  <div className="grid grid-cols-2 gap-3">
                    <InlineField
                      label="First Name"
                      name="first_name"
                      value={profile.first_name ?? ""}
                      readOnly
                    />
                    <InlineField
                      label="Last Name"
                      name="last_name"
                      value={profile.last_name ?? ""}
                      readOnly
                    />
                  </div>
                  <InlineField
                    label="Headline"
                    name="headline"
                    value={headerForm.headline}
                    onChange={(e) =>
                      setHeaderForm((p) => ({ ...p, headline: e.target.value }))
                    }
                  />
                  <p className="text-xs text-gray-400">
                    First &amp; last name can only be changed by contacting
                    support.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={saveHeader}
                      disabled={updateMutation.isPending}
                      className="flex items-center gap-1.5 px-4 py-1.5 bg-[#ff9933] text-white text-sm font-semibold rounded-full hover:bg-[#e68829] disabled:opacity-60 transition-colors"
                    >
                      {updateMutation.isPending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      Save
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="px-4 py-1.5 border border-gray-300 text-gray-600 text-sm rounded-full hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-2xl font-bold text-gray-900">
                      {fullName}
                    </h1>
                    {profile.is_consultant_verified && (
                      <span title="Verified consultant">
                        <BadgeCheck className="w-5 h-5 text-[#ff9933] shrink-0" />
                      </span>
                    )}
                  </div>
                  {profile.headline && (
                    <p className="text-gray-600 text-sm mt-0.5 leading-snug">
                      {profile.headline}
                    </p>
                  )}
                  {(profile.city || profile.country) && (
                    <div className="flex items-center gap-1 text-xs text-gray-500 mt-1.5">
                      <MapPin className="w-3 h-3" />
                      {[profile.city, profile.country]
                        .filter(Boolean)
                        .join(", ")}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* ══ ACCOUNT TYPE SECTION (owner only) ════════════════════════ */}
          {isOwner && (
            <div className="mb-3">
              <AccountTypeSection
                profile={profile}
                isOwner={isOwner}
                onSwitch={(updated) => {
                  useAuthStore.getState().setProfile(updated);
                  // Immediately patch both caches so useProfileQuery never
                  // overwrites Zustand with a stale active_persona.
                  qc.setQueryData<FullProfile>(
                    profileKeys.full(profileId),
                    (old) => old ? { ...old, active_persona: updated.active_persona } : old,
                  );
                  qc.setQueryData(
                    ["profile", user?.id ?? ""],
                    (old: any) => old ? { ...old, active_persona: updated.active_persona } : old,
                  );
                }}
              />
            </div>
          )}

          {/* ══ 2-COLUMN LAYOUT ════════════════════════════════════════════ */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* LEFT SIDEBAR */}
            <div className="space-y-3">
              {/* Contact */}
              <Card className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900 text-sm">
                    Contact Info
                  </h3>
                  {isOwner && !isEditing("contact") && (
                    <button
                      onClick={() => setEditSection("contact")}
                      className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
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
                        className="flex-1 py-1.5 bg-[#ff9933] text-white text-sm font-semibold rounded-full hover:bg-[#e68829] disabled:opacity-60 flex items-center justify-center gap-1"
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
                        className="flex-1 py-1.5 border border-gray-300 text-gray-600 text-sm rounded-full hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {profile.email && (
                      <div className="flex items-start gap-2">
                        <Mail className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
                        <span className="text-xs text-gray-600">{profile.email}</span>
                      </div>
                    )}
                    {profile.phone_number && (
                      <div className="flex items-start gap-2">
                        <Phone className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs text-gray-600">{profile.phone_number}</span>
                          <span className="text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                            Unverified
                          </span>
                        </div>
                      </div>
                    )}
                    {[profile.city, profile.country].filter(Boolean).join(", ") && (
                      <div className="flex items-start gap-2">
                        <MapPin className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
                        <span className="text-xs text-gray-600">
                          {[profile.city, profile.country].filter(Boolean).join(", ")}
                        </span>
                      </div>
                    )}
                    {!profile.email &&
                      !profile.phone_number &&
                      !profile.city && (
                        <p className="text-xs text-gray-400 italic">
                          No contact info added.
                        </p>
                      )}
                  </div>
                )}
              </Card>

              {/* Rate & Availability */}
              <Card className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900 text-sm">
                    Rate &amp; Availability
                  </h3>
                  {isOwner && !isEditing("rate") && (
                    <button
                      onClick={() => setEditSection("rate")}
                      className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
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
                      <label className="block text-xs font-medium text-gray-500 mb-1">
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
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff9933]/50"
                      >
                        {["USD", "EUR", "GBP", "PHP", "AUD", "CAD"].map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
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
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff9933]/50"
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
                        className="flex-1 py-1.5 bg-[#ff9933] text-white text-sm font-semibold rounded-full hover:bg-[#e68829] flex items-center justify-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5" /> Save
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="flex-1 py-1.5 border border-gray-300 text-gray-600 text-sm rounded-full hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {profile.rate_settings?.hourly_rate ? (
                      <div className="flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-gray-400" />
                        <span className="text-sm font-semibold text-gray-800">
                          {profile.rate_settings.hourly_rate}{" "}
                          {profile.rate_settings.currency}
                          <span className="font-normal text-gray-500">/hr</span>
                        </span>
                      </div>
                    ) : isOwner ? (
                      <p className="text-xs text-gray-400 italic">
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
                  <h3 className="font-semibold text-gray-900 text-sm">
                    Languages
                  </h3>
                  {isOwner && (
                    <button
                      onClick={() => setLangModalOpen(true)}
                      className="p-1.5 rounded-full border border-gray-200 text-gray-400 hover:bg-gray-100 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
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
                          <Globe className="w-4 h-4 text-gray-400 shrink-0" />
                          <div className="flex flex-col">
                            <span className="text-sm font-semibold text-gray-900">
                              {l.language.name}
                            </span>
                            <span className="text-xs text-gray-500 capitalize">
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
                              className="p-1.5 rounded-lg text-gray-400 hover:text-[#ff9933] hover:bg-orange-50 transition-colors"
                              title="Edit"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => deleteLanguage.mutate(l.id)}
                              disabled={deleteLanguage.isPending}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
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
                  <EmptyState message="No languages added." />
                )}
              </Card>

              {/* Stats */}
              {profile.stats && (
                <Card className="p-5">
                  <h3 className="font-semibold text-gray-900 text-sm mb-3">
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
                        className="flex flex-col items-center p-2 bg-gray-50 rounded-xl"
                      >
                        <Icon className="w-4 h-4 text-[#ff9933] mb-1" />
                        <span className="text-sm font-bold text-gray-900">
                          {val}
                        </span>
                        <span className="text-xs text-gray-400">{label}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
              {/* Identity Documents (KYC/KYB) - Only visible to owner/admins */}
              {isOwner && (
                <Card className="p-5 border-[#14b8a6]/20 bg-teal-50/10">
                  <div className="flex items-center justify-between mb-3 border-b border-[#14b8a6]/10 pb-2">
                    <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-[#14b8a6]" />
                      Verification Documents
                    </h3>
                    <button
                      onClick={() => setIdDocModalOpen(true)}
                      className="p-1.5 rounded-full border border-gray-200 text-gray-400 hover:bg-white transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {profile.identity_documents?.length > 0 ? (
                    <div className="space-y-3">
                      {profile.identity_documents.map((doc) => (
                        <div
                          key={doc.id}
                          className="flex items-center justify-between group bg-white p-2.5 rounded-xl border border-gray-100 shadow-sm"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${doc.is_verified ? "bg-green-100" : "bg-gray-100"}`}
                            >
                              {doc.is_verified ? (
                                <Check className="w-4 h-4 text-green-600" />
                              ) : (
                                <Loader2 className="w-4 h-4 text-gray-400" />
                              )}
                            </div>
                            <div className="flex flex-col">
                              <span className="text-sm font-semibold text-gray-900 capitalize">
                                {doc.type.replace("_", " ")}
                              </span>
                              <span className="text-xs text-gray-500">
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
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
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
                    <EmptyState message="No identity documents provided." />
                  )}
                </Card>
              )}
            </div>

            {/* RIGHT MAIN CONTENT */}
            <div className="lg:col-span-2 space-y-3">
              {/* ── About & Skills (merged card) ─────────────────────────── */}
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-gray-900">About</h2>
                  {isOwner && (
                    <button
                      onClick={() => setAboutModalOpen(true)}
                      className="p-1.5 rounded-full border border-gray-200 text-gray-400 hover:bg-gray-100 transition-colors"
                      title="Edit about & skills"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Bio */}
                {profile.bio ? (
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line mb-5">
                    {profile.bio}
                  </p>
                ) : isOwner ? (
                  <button
                    onClick={() => setAboutModalOpen(true)}
                    className="block w-full text-left text-sm text-gray-400 italic mb-5 hover:text-[#ff9933] transition-colors"
                  >
                    + Add a professional summary…
                  </button>
                ) : (
                  <p className="text-sm text-gray-400 italic mb-5">
                    No overview provided.
                  </p>
                )}

                {/* Divider */}
                {(profile.bio ||
                  profile.skills.length > 0 ||
                  profile.specializations.length > 0) && (
                  <hr className="border-gray-100 mb-4" />
                )}

                {/* Specializations */}
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-700">
                    Specializations
                  </h3>
                  {isOwner && (
                    <button
                      onClick={() => setSpecModalOpen(true)}
                      className="text-xs text-[#ff9933] font-semibold hover:underline flex items-center gap-0.5"
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
                        className="group relative pr-12 border-l-2 border-[#ff9933]/30 pl-3"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-gray-900 text-sm capitalize">
                            {s.category.replace("_", " ")}
                          </span>
                          {s.years_of_experience && (
                            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                              {s.years_of_experience} yrs
                            </span>
                          )}
                        </div>
                        {s.sub_category && (
                          <p className="text-xs font-medium text-gray-500 mb-1">
                            {s.sub_category}
                          </p>
                        )}
                        {s.description && (
                          <p className="text-sm text-gray-600 line-clamp-2">
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
                              className="p-1 text-gray-400 hover:text-[#ff9933]"
                              title="Edit"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => deleteSpecialization.mutate(s.id)}
                              className="p-1 text-gray-400 hover:text-red-500"
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
                  <EmptyState message="No specializations added." />
                )}

                {/* Skills */}
                <div className="flex items-center justify-between mb-3 mt-4">
                  <h3 className="text-sm font-semibold text-gray-700">
                    Skills
                  </h3>
                  {isOwner && profile.skills.length === 0 && (
                    <button
                      onClick={() => setAboutModalOpen(true)}
                      className="text-xs text-[#ff9933] font-semibold hover:underline flex items-center gap-0.5"
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
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-full text-sm text-gray-700 transition-colors"
                      >
                        {s.skill.name}
                        <ProficiencyDot level={s.proficiency_level} />
                      </span>
                    ))}
                  </div>
                ) : (
                  <EmptyState message="No skills added yet." />
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
                    <div className="absolute left-[18px] top-2 bottom-2 w-px bg-gray-200" />
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
                            <div className="absolute left-0 top-1 w-9 h-9 rounded-full bg-white border-2 border-gray-900 flex items-center justify-center shrink-0 shadow-sm">
                              <Building2
                                className="w-4 h-4 text-gray-900"
                                strokeWidth={2.5}
                              />
                            </div>
                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="font-bold text-gray-900 text-sm leading-tight">
                                    {exp.title}
                                  </p>
                                  <p className="text-gray-600 text-sm">
                                    {exp.company}
                                  </p>
                                  <p className="text-gray-400 text-xs mt-0.5">
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
                                      className="p-1 rounded text-gray-300 hover:text-[#ff9933] hover:bg-orange-50 transition-colors"
                                      title="Edit"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() =>
                                        deleteExperience.mutate(exp.id)
                                      }
                                      disabled={deleteExperience.isPending}
                                      className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
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
                                <p className="text-gray-600 text-sm mt-1.5 leading-relaxed">
                                  {exp.description}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <EmptyState message="No work experience added." />
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
                  <div className="divide-y divide-gray-100">
                    {profile.educations.map((edu) => (
                      <div
                        key={edu.id}
                        className="py-4 flex items-start gap-4 group first:pt-0 last:pb-0"
                      >
                        {/* Bold black icon */}
                        <div className="w-10 h-10 rounded-lg border-2 border-gray-900 flex items-center justify-center shrink-0 bg-white shadow-sm">
                          <BookOpen
                            className="w-5 h-5 text-gray-900"
                            strokeWidth={2.5}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-gray-900 text-sm">
                            {edu.institution}
                          </p>
                          <p className="text-gray-600 text-sm">
                            {[edu.degree, edu.field_of_study]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          {(edu.start_year || edu.end_year) && (
                            <p className="text-gray-400 text-xs mt-0.5">
                              {edu.start_year && `${edu.start_year}`}
                              {edu.end_year &&
                                ` – ${edu.is_current ? "Present" : edu.end_year}`}
                            </p>
                          )}
                          {edu.description && (
                            <p className="text-gray-500 text-xs mt-1">
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
                              className="p-1 rounded text-gray-300 hover:text-[#ff9933] hover:bg-orange-50 transition-colors"
                              title="Edit"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => deleteEducation.mutate(edu.id)}
                              disabled={deleteEducation.isPending}
                              className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
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
                  <EmptyState message="No education added." />
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
                  <div className="divide-y divide-gray-100">
                    {profile.certifications.map((cert) => (
                      <div
                        key={cert.id}
                        className="py-4 flex items-start gap-4 group first:pt-0 last:pb-0"
                      >
                        <div className="w-10 h-10 rounded-lg border-2 border-gray-900 flex items-center justify-center shrink-0 bg-white shadow-sm">
                          <Award
                            className="w-5 h-5 text-gray-900"
                            strokeWidth={2.5}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="font-bold text-gray-900 text-sm">
                              {cert.name}
                            </p>
                            {cert.is_verified && (
                              <BadgeCheck className="w-3.5 h-3.5 text-green-600" />
                            )}
                          </div>
                          <p className="text-gray-600 text-sm">{cert.issuer}</p>
                          <div className="flex flex-wrap items-center gap-3 mt-0.5">
                            {cert.issue_date && (
                              <p className="text-gray-400 text-xs">
                                Issued {fmtDate(cert.issue_date)}
                              </p>
                            )}
                            {cert.credential_id && (
                              <p className="text-gray-400 text-xs">
                                ID: {cert.credential_id}
                              </p>
                            )}
                          </div>
                          {cert.credential_url && (
                            <a
                              href={cert.credential_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 mt-1.5 text-xs border border-gray-300 text-gray-600 px-3 py-1 rounded-full hover:bg-gray-50 transition-colors"
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
                              className="p-1 rounded text-gray-300 hover:text-[#ff9933] hover:bg-orange-50 transition-colors"
                              title="Edit"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() =>
                                deleteCertification.mutate(cert.id)
                              }
                              disabled={deleteCertification.isPending}
                              className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
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
                  <EmptyState message="No certifications added." />
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
                          <h4 className="text-sm font-bold text-gray-900">
                            {lic.name}
                          </h4>
                          <p className="text-sm text-gray-600 mb-1">
                            {lic.issuing_authority}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
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
                              className="p-1 hover:text-[#ff9933] text-gray-400 transition-colors"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => deleteLicense.mutate(lic.id)}
                              className="p-1 hover:text-red-500 text-gray-400 transition-colors"
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
                  <EmptyState message="No licenses added." />
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
                          className="group relative border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow"
                        >
                          {item.image_url ? (
                            <img
                              src={item.image_url}
                              alt={item.title}
                              className="w-full aspect-video object-cover"
                            />
                          ) : (
                            <div className="w-full aspect-video bg-gray-100 flex items-center justify-center">
                              <LayoutGrid className="w-8 h-8 text-gray-300" />
                            </div>
                          )}
                          <div className="p-3">
                            <p className="font-semibold text-gray-900 text-sm">
                              {item.title}
                            </p>
                            {item.description && (
                              <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                                {item.description}
                              </p>
                            )}
                            {item.url && (
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 mt-1.5 text-xs text-[#ff9933] hover:underline"
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
                                    className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full"
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
                                className="p-1.5 bg-white/90 border border-gray-200 rounded-lg text-gray-400 hover:text-[#ff9933] shadow-sm transition-colors"
                                title="Edit"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => deletePortfolio.mutate(item.id)}
                                disabled={deletePortfolio.isPending}
                                className="p-1.5 bg-white/90 border border-gray-200 rounded-lg text-gray-400 hover:text-red-500 shadow-sm transition-colors"
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
                    <EmptyState message="No portfolio items added." />
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
