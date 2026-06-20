import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { ModalPortal } from "@/components/common/ModalPortal";
import {
  Check,
  Loader2,
  CheckCircle2,
  FileText,
  LayoutGrid,
  ExternalLink,
  Edit2,
  Trash2,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { StepIndicator } from "@/components/project-brief";
import { PortfolioModal } from "@/components/profile/PortfolioModal";
import {
  profileService,
  type AvailabilityStatus,
  type IdentityDocumentType,
  type SkillMeta,
  type SpecializationCategory,
  type UserPortfolio,
} from "@/services/profile.service";
import { uploadService } from "@/services/upload.service";
import { IdentityDocumentModal } from "@/components/profile/IdentityDocumentModal";

export const Route = createFileRoute("/freelancer/go-live")({
  beforeLoad: () => {
    const { isAuthenticated } = useAuthStore.getState();
    if (!isAuthenticated) throw redirect({ to: "/auth/login" });
  },
  component: FreelancerGoLivePage,
});

const profileKeys = { full: (id: string) => ["full-profile", id] as const };

const STEP_META = [
  { label: "Availability" },
  { label: "Specialization" },
  { label: "Skills" },
  { label: "Portfolio" },
  { label: "Identity*" },
  { label: "Review" },
];

const STEP_DESCRIPTIONS = [
  {
    title: "Step 1: Availability & Rate",
    body: "Let clients know when you're available to work and set your expected hourly rate. This helps us match you with projects that fit your schedule.",
  },
  {
    title: "Step 2: Primary Specialization",
    body: "Highlight your main area of expertise. Choosing an accurate specialization increases your chances of being discovered by verified consultants.",
  },
  {
    title: "Step 3: Skills Confirmation",
    body: "Select the specific skills you want to highlight on your public profile. Only verified skills will be shown to potential clients.",
  },
  {
    title: "Step 4: Featured Portfolio",
    body: "Choose the portfolio item you want to appear first on your profile. A strong featured project makes a great first impression.",
  },
  {
    title: "Step 5: Identity Verification",
    body: "Upload a government-issued photo ID. This is a mandatory step to ensure the security and authenticity of our freelancer community.",
  },
  {
    title: "Step 6: Review & Go Live",
    body: "Review your activation details before going live. Once activated, your profile will be visible to consultants looking for your expertise.",
  },
];

const SPECIALIZATION_CATEGORIES = [
  { value: "fintech", label: "Fintech" },
  { value: "healthcare", label: "Healthcare" },
  { value: "e_commerce", label: "E-Commerce" },
  { value: "saas", label: "SaaS" },
  { value: "education", label: "Education" },
  { value: "real_estate", label: "Real Estate" },
  { value: "legal", label: "Legal" },
  { value: "marketing", label: "Marketing" },
  { value: "logistics", label: "Logistics" },
  { value: "media", label: "Media" },
  { value: "gaming", label: "Gaming" },
  { value: "ai_ml", label: "AI / ML" },
  { value: "cybersecurity", label: "Cybersecurity" },
  { value: "blockchain", label: "Blockchain" },
  { value: "other", label: "Other" },
];

function TileOption({
  name,
  value,
  label,
  checked,
  onChange,
  description,
}: {
  name: string;
  value: string;
  label: string;
  checked: boolean;
  onChange: () => void;
  description?: string;
}) {
  return (
    <label
      className={`flex items-start gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${checked ? "border-[#3b82f6] bg-blue-50 shadow-sm" : "border-gray-200 bg-white hover:border-gray-300"}`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 w-4 h-4 accent-[#3b82f6] shrink-0"
      />
      <div>
        <p className="text-sm font-semibold text-[#333438]">{label}</p>
        {description && (
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        )}
      </div>
    </label>
  );
}

const ReviewRow = ({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) => (
  <div className="flex gap-3 text-sm py-1.5 border-b border-gray-100 last:border-0">
    <span className="text-[#61636c] w-36 shrink-0">{label}</span>
    <span className="text-[#333438] font-medium flex-1 pl-2 truncate">
      {value || "—"}
    </span>
  </div>
);

function FreelancerGoLivePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [currentStep, setCurrentStep] = useState(1);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  const profileQuery = useQuery({
    queryKey: profileKeys.full(user?.id || ""),
    queryFn: () => profileService.getProfile(user!.id),
    enabled: !!user?.id,
  });

  const skillsMetaQuery = useQuery({
    queryKey: ["profileMeta", "skills"],
    queryFn: () => profileService.getAllSkills(),
    staleTime: 60 * 60 * 1000,
  });

  const profile = profileQuery.data;
  const existingSpec = profile?.specializations?.[0];
  const existingRate = profile?.rate_settings;
  const sortedPortfolios = useMemo(
    () =>
      [...(profile?.portfolios || [])].sort((a, b) => a.position - b.position),
    [profile?.portfolios],
  );

  const [availability, setAvailability] =
    useState<AvailabilityStatus>("available");
  const [hourlyRate, setHourlyRate] = useState<string>("0");
  const [currency, setCurrency] = useState("USD");
  const [weeklyHours, setWeeklyHours] = useState<string>("10");
  const [specCategory, setSpecCategory] =
    useState<SpecializationCategory>("other");
  const [specSubcategory, setSpecSubcategory] = useState("");
  const [specYears, setSpecYears] = useState<string>("");
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [featuredPortfolioId, setFeaturedPortfolioId] = useState<string>("");
  const [portfolioModalOpen, setPortfolioModalOpen] = useState(false);
  const [editingPortfolio, setEditingPortfolio] =
    useState<UserPortfolio | null>(null);
  const [pendingIdentityUpload, setPendingIdentityUpload] = useState<{
    type: IdentityDocumentType;
    file: File;
  } | null>(null);
  const [identityModalOpen, setIdentityModalOpen] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    if (!profile || isHydrated) return;

    setAvailability(existingRate?.availability || "available");
    setHourlyRate(String(existingRate?.hourly_rate ?? 0));
    setCurrency(existingRate?.currency || "USD");
    setWeeklyHours(String(existingRate?.weekly_hours ?? 10));

    setSpecCategory(
      (existingSpec?.category as SpecializationCategory) || "other",
    );
    setSpecSubcategory(existingSpec?.sub_category || "");
    setSpecYears(String(existingSpec?.years_of_experience || ""));

    setSelectedSkillIds(profile.skills.map((skill) => skill.skill.id));
    setFeaturedPortfolioId(sortedPortfolios[0]?.id || "");
    setIsHydrated(true);
  }, [existingRate, existingSpec, isHydrated, profile, sortedPortfolios]);

  const currentSkills = useMemo(() => {
    const selected = new Set(selectedSkillIds);
    return (skillsMetaQuery.data || []).filter((skill) =>
      selected.has(skill.id),
    );
  }, [skillsMetaQuery.data, selectedSkillIds]);

  const saveRateMutation = useMutation({
    mutationFn: () =>
      profileService.updateRateSettings({
        availability,
        hourly_rate: Number(hourlyRate) || 0,
        currency,
        weekly_hours: Number(weeklyHours) || 0,
      }),
  });

  const saveSpecMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        category: specCategory,
        sub_category: specSubcategory || undefined,
        years_of_experience: specYears ? Number(specYears) : undefined,
      };

      if (existingSpec?.id) {
        return profileService.updateSpecialization(existingSpec.id, payload);
      }

      return profileService.addSpecialization(payload);
    },
  });

  const saveSkillsMutation = useMutation({
    mutationFn: async () => {
      if (!profile) return;
      const uniqueSkillIds = [...new Set(selectedSkillIds)].filter(
        (skillId): skillId is string =>
          typeof skillId === "string" && skillId.trim().length > 0,
      );

      const mapped = uniqueSkillIds.map((skillId) => {
        const existing = profile.skills.find(
          (item) => item.skill.id === skillId,
        );
        return {
          skill_id: skillId,
          proficiency_level: existing?.proficiency_level || "intermediate",
          years_experience: existing?.years_experience || 1,
        };
      });
      return profileService.updateSkills(mapped);
    },
  });

  const savePortfolioMutation = useMutation({
    mutationFn: async () => {
      if (!profile || !featuredPortfolioId) return;
      const target = sortedPortfolios.find(
        (portfolio) => portfolio.id === featuredPortfolioId,
      );
      if (!target) return;

      await profileService.updatePortfolio(target.id, { position: 0 });

      const others = sortedPortfolios.filter(
        (portfolio) => portfolio.id !== target.id,
      );
      await Promise.all(
        others.map((portfolio, index) =>
          profileService.updatePortfolio(portfolio.id, { position: index + 1 }),
        ),
      );
    },
  });

  const addPortfolioMutation = useMutation({
    mutationFn: profileService.addPortfolio.bind(profileService),
    onSuccess: () => {
      if (!user?.id) return;
      void qc.invalidateQueries({ queryKey: profileKeys.full(user.id) });
      setPortfolioModalOpen(false);
      setEditingPortfolio(null);
    },
  });

  const updatePortfolioMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) =>
      profileService.updatePortfolio(id, payload),
    onSuccess: () => {
      if (!user?.id) return;
      void qc.invalidateQueries({ queryKey: profileKeys.full(user.id) });
      setPortfolioModalOpen(false);
      setEditingPortfolio(null);
    },
  });

  const deletePortfolioMutation = useMutation({
    mutationFn: profileService.deletePortfolio.bind(profileService),
    onSuccess: () => {
      if (!user?.id) return;
      void qc.invalidateQueries({ queryKey: profileKeys.full(user.id) });
      if (featuredPortfolioId) {
        const next = sortedPortfolios.find((p) => p.id !== featuredPortfolioId);
        setFeaturedPortfolioId(next?.id || "");
      }
    },
  });

  const saveIdentityMutation = useMutation({
    mutationFn: async () => {
      if (!pendingIdentityUpload) return;
      const storagePath = await uploadService.upload(
        "identity_documents" as any,
        pendingIdentityUpload.file,
      );
      return profileService.addIdentityDocument({
        type: pendingIdentityUpload.type,
        storage_path: storagePath,
      });
    },
    onSuccess: () => {
      setPendingIdentityUpload(null);
    },
  });

  const submitAllMutation = useMutation({
    mutationFn: async () => {
      await saveRateMutation.mutateAsync();
      await saveSpecMutation.mutateAsync();
      await saveSkillsMutation.mutateAsync();
      await savePortfolioMutation.mutateAsync();
      if (pendingIdentityUpload) {
        await saveIdentityMutation.mutateAsync();
      }
      return profileService.goLive();
    },
    onSuccess: () => {
      setShowSuccessModal(true);
      if (!user?.id) return;
      void qc.invalidateQueries({ queryKey: profileKeys.full(user.id) });
    },
  });

  const totalIdentityCount =
    (profile?.identity_documents.length || 0) + (pendingIdentityUpload ? 1 : 0);

  const saveCurrentStep = async () => {
    setErrorText(null);
    try {
      if (currentStep < 6) {
        if (currentStep === 5 && totalIdentityCount === 0) {
          setErrorText(
            "Please upload at least one identity document before continuing.",
          );
          return;
        }
        setCurrentStep((s) => Math.min(s + 1, 6));
      } else {
        await submitAllMutation.mutateAsync();
      }
    } catch (error) {
      setErrorText(
        error instanceof Error
          ? error.message
          : "Failed to submit go-live form",
      );
    }
  };

  const isSaving =
    saveRateMutation.isPending ||
    saveSpecMutation.isPending ||
    saveSkillsMutation.isPending ||
    savePortfolioMutation.isPending ||
    saveIdentityMutation.isPending ||
    submitAllMutation.isPending;

  if (profileQuery.isLoading) {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#3b82f6]" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center">
        <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
          <h2 className="text-lg font-semibold text-gray-900">
            Profile unavailable
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Unable to load your profile data.
          </p>
        </div>
      </div>
    );
  }

  const desc = STEP_DESCRIPTIONS[currentStep - 1];

  return (
    <div className="min-h-screen bg-[#f6f7f8] relative overflow-hidden pt-20">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        <motion.svg
          className="absolute bottom-0 left-0 w-full h-[700px] opacity-20"
          viewBox="0 0 1440 320"
          preserveAspectRatio="none"
          animate={{ y: [0, -30, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        >
          <motion.path
            d="M0,96L48,112C96,128,192,160,288,160C384,160,480,128,576,122.7C672,117,768,139,864,144C960,149,1056,139,1152,128C1248,117,1344,107,1392,101.3L1440,96L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
            fill={
              currentStep <= 2
                ? "#3b82f6"
                : currentStep <= 4
                  ? "#6366f1"
                  : "#8b5cf6"
            }
            fillOpacity="0.5"
            animate={{
              fill:
                currentStep <= 2
                  ? "#3b82f6"
                  : currentStep <= 4
                    ? "#6366f1"
                    : "#8b5cf6",
            }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
          />
        </motion.svg>
        <motion.div
          className="absolute top-20 left-10 w-[400px] h-[400px] bg-blue-400 rounded-full blur-3xl opacity-20"
          animate={{ scale: [1, 1.3, 1], x: [0, 50, 0], y: [0, -40, 0] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute top-40 right-20 w-[350px] h-[350px] bg-indigo-400 rounded-full blur-3xl opacity-20"
          animate={{ scale: [1, 1.4, 1], x: [0, -40, 0], y: [0, 35, 0] }}
          transition={{
            duration: 7,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 0.5,
          }}
        />
        <motion.div
          className="absolute bottom-40 left-1/3 w-[300px] h-[300px] bg-violet-400 rounded-full blur-3xl opacity-20"
          animate={{ scale: [1, 1.5, 1], x: [0, 30, 0], y: [0, -30, 0] }}
          transition={{
            duration: 9,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 1,
          }}
        />
      </div>

      <div className="max-w-[1440px] mx-auto px-20 py-8 pb-40 relative z-10">
        {/* Step Indicators */}
        <div className="flex items-center justify-center mb-14 gap-0">
          {STEP_META.map((s, i) => (
            <div key={i} className="flex items-center">
              <div className="flex flex-col items-center min-w-[84px]">
                <StepIndicator
                  step={i + 1}
                  currentStep={currentStep}
                  label={s.label}
                  totalSteps={6}
                />
              </div>

              {i < STEP_META.length - 1 && (
                <div className="w-14 h-1 bg-gray-200 rounded-full mx-1 overflow-hidden mt-[-24px]">
                  <motion.div
                    className="h-full bg-[#ff9933]"
                    initial={{ width: "0%" }}
                    animate={{ width: currentStep > i + 1 ? "100%" : "0%" }}
                    transition={{ duration: 0.5, ease: "easeInOut" }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-[380px_1fr] gap-12">
          {/* Left: sticky description */}
          <div className="relative">
            <div className="sticky top-[120px]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentStep}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                >
                  <h1 className="text-4xl font-bold text-[#333438] mb-4 leading-tight">
                    {desc.title}
                  </h1>
                  <p className="text-[#61636c] text-lg">{desc.body}</p>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* Right: form */}
          <div className="min-h-[500px]">
            {errorText && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-4 mb-6 text-sm text-red-700 font-medium">
                {errorText}
              </div>
            )}

            <AnimatePresence mode="wait">
              {currentStep === 1 && (
                <motion.div
                  key="s1"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="space-y-6"
                >
                  <div>
                    <label className="block text-sm font-semibold text-[#333438] mb-3">
                      Availability <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <TileOption
                        name="availability"
                        value="available"
                        label="Available"
                        description="Ready for full-time or new projects"
                        checked={availability === "available"}
                        onChange={() => setAvailability("available")}
                      />
                      <TileOption
                        name="availability"
                        value="partially_available"
                        label="Partially Available"
                        description="Open for part-time engagements"
                        checked={availability === "partially_available"}
                        onChange={() => setAvailability("partially_available")}
                      />
                      <TileOption
                        name="availability"
                        value="unavailable"
                        label="Unavailable"
                        description="Not looking for new opportunities"
                        checked={availability === "unavailable"}
                        onChange={() => setAvailability("unavailable")}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-[#333438] mb-2">
                        Hourly Rate <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">
                          $
                        </span>
                        <input
                          type="number"
                          min={0}
                          value={hourlyRate}
                          onChange={(e) => setHourlyRate(e.target.value)}
                          className="w-full pl-8 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-[#333438] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:border-transparent shadow-sm"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-[#333438] mb-2">
                        Currency <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={currency}
                        onChange={(e) =>
                          setCurrency(e.target.value.toUpperCase())
                        }
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-[#333438] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:border-transparent shadow-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-[#333438] mb-2">
                      Weekly Hours <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={weeklyHours}
                      onChange={(e) => setWeeklyHours(e.target.value)}
                      className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-[#333438] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:border-transparent shadow-sm"
                    />
                  </div>
                </motion.div>
              )}

              {currentStep === 2 && (
                <motion.div
                  key="s2"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="space-y-6"
                >
                  <div>
                    <label className="block text-sm font-semibold text-[#333438] mb-3">
                      Category <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {SPECIALIZATION_CATEGORIES.map((cat) => (
                        <TileOption
                          key={cat.value}
                          name="spec_category"
                          value={cat.value}
                          label={cat.label}
                          checked={specCategory === cat.value}
                          onChange={() =>
                            setSpecCategory(cat.value as SpecializationCategory)
                          }
                        />
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-[#333438] mb-2">
                        Sub-category
                      </label>
                      <input
                        value={specSubcategory}
                        onChange={(e) => setSpecSubcategory(e.target.value)}
                        placeholder="e.g. Frontend Development"
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-[#333438] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:border-transparent shadow-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-[#333438] mb-2">
                        Years of Experience{" "}
                        <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={specYears}
                        onChange={(e) => setSpecYears(e.target.value)}
                        placeholder="e.g. 5"
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-[#333438] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:border-transparent shadow-sm"
                      />
                    </div>
                  </div>
                </motion.div>
              )}

              {currentStep === 3 && (
                <motion.div
                  key="s3"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="space-y-4"
                >
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800">
                    Your skills make you discoverable! Select the core
                    technologies and methodologies you excel at.
                  </div>
                  <div className="grid grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-2 pb-2">
                    {(skillsMetaQuery.data || []).map((skill: SkillMeta) => {
                      const checked = selectedSkillIds.includes(skill.id);
                      return (
                        <label
                          key={skill.id}
                          className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${checked ? "border-[#3b82f6] bg-blue-50 shadow-sm" : "border-gray-200 bg-white hover:border-gray-300"}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setSelectedSkillIds((prev) =>
                                checked
                                  ? prev.filter((id) => id !== skill.id)
                                  : [...prev, skill.id],
                              );
                            }}
                            className="w-4 h-4 accent-[#3b82f6] shrink-0 rounded"
                          />
                          <span className="text-sm font-medium text-[#333438]">
                            {skill.name}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="text-right text-sm text-gray-500 mt-2 font-medium">
                    {currentSkills.length} selected
                  </div>
                </motion.div>
              )}

              {currentStep === 4 && (
                <motion.div
                  key="s4"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="space-y-4"
                >
                  {sortedPortfolios.length > 0 ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-[#333438]">
                          Portfolio Upload
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingPortfolio(null);
                            setPortfolioModalOpen(true);
                          }}
                          className="text-xs text-[#3b82f6] font-semibold hover:underline"
                        >
                          Add portfolio
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {sortedPortfolios.map((portfolio) => (
                          <div
                            key={portfolio.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setFeaturedPortfolioId(portfolio.id)}
                            onKeyDown={(event) => {
                              if (
                                event.key === "Enter" ||
                                event.key === " " ||
                                event.key === "Spacebar"
                              ) {
                                event.preventDefault();
                                setFeaturedPortfolioId(portfolio.id);
                              }
                            }}
                            className={`group relative border rounded-xl overflow-hidden hover:shadow-md transition-shadow cursor-pointer ${
                              featuredPortfolioId === portfolio.id
                                ? "border-[#3b82f6] ring-1 ring-[#3b82f6]"
                                : "border-gray-200"
                            }`}
                          >
                            {portfolio.image_url ? (
                              <img
                                src={portfolio.image_url}
                                alt={portfolio.title}
                                className="w-full aspect-video object-cover"
                              />
                            ) : (
                              <div className="w-full aspect-video bg-gray-100 flex items-center justify-center">
                                <LayoutGrid className="w-8 h-8 text-gray-300" />
                              </div>
                            )}
                            <div className="p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-semibold text-gray-900 text-sm">
                                  {portfolio.title}
                                </p>
                                {featuredPortfolioId === portfolio.id && (
                                  <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 shrink-0">
                                    Featured
                                  </span>
                                )}
                              </div>
                              {portfolio.description && (
                                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                                  {portfolio.description}
                                </p>
                              )}
                              {portfolio.url && (
                                <a
                                  href={portfolio.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 mt-1.5 text-xs text-[#3b82f6] hover:underline"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <ExternalLink className="w-3 h-3" /> View
                                  project
                                </a>
                              )}
                              {portfolio.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {portfolio.tags.map((tag) => (
                                    <span
                                      key={tag}
                                      className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setEditingPortfolio(portfolio);
                                  setPortfolioModalOpen(true);
                                }}
                                className="p-1.5 bg-white/90 border border-gray-200 rounded-lg text-gray-400 hover:text-[#3b82f6] shadow-sm transition-colors"
                                title="Edit"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  deletePortfolioMutation.mutate(portfolio.id);
                                }}
                                disabled={deletePortfolioMutation.isPending}
                                className="p-1.5 bg-white/90 border border-gray-200 rounded-lg text-gray-400 hover:text-red-500 shadow-sm transition-colors"
                              >
                                {deletePortfolioMutation.isPending ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <p className="text-xs text-gray-500">
                        Select a card to mark it as featured on your profile.
                      </p>

                      {sortedPortfolios.map((portfolio) => (
                        <input
                          key={portfolio.id}
                          type="radio"
                          name="featured-portfolio"
                          checked={featuredPortfolioId === portfolio.id}
                          onChange={() => setFeaturedPortfolioId(portfolio.id)}
                          className="sr-only"
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center bg-white border border-gray-200 rounded-2xl">
                      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <LayoutGrid className="w-8 h-8 text-gray-400" />
                      </div>
                      <h3 className="text-lg font-bold text-[#333438]">
                        No portfolio items yet
                      </h3>
                      <p className="text-sm text-gray-500 mt-2">
                        Add your first portfolio entry to showcase your work and
                        choose what appears first on your public profile.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingPortfolio(null);
                          setPortfolioModalOpen(true);
                        }}
                        className="mt-4 inline-flex items-center justify-center px-4 py-2 rounded-lg bg-[#3b82f6] text-white text-sm font-medium hover:bg-[#2563eb] transition-colors"
                      >
                        Add portfolio
                      </button>
                    </div>
                  )}
                </motion.div>
              )}

              {currentStep === 5 && (
                <motion.div
                  key="s5"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="space-y-6"
                >
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 flex gap-3 items-start">
                    <Check className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
                    <p>
                      Your documents are securely encrypted and only accessible
                      to authorized verification staff. This helps us maintain a
                      high-quality talent pool.
                    </p>
                  </div>

                  <div className="space-y-5 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                    {profile.identity_documents.length > 0 && (
                      <div className="space-y-3">
                        {profile.identity_documents.map((doc) => (
                          <div
                            key={doc.id}
                            className="flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-xl"
                          >
                            <div
                              className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${doc.is_verified ? "bg-green-100" : "bg-gray-100"}`}
                            >
                              <FileText
                                className={`w-5 h-5 ${doc.is_verified ? "text-green-600" : "text-gray-400"}`}
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-gray-900 capitalize">
                                {doc.type.replace("_", " ")}
                              </p>
                              <p className="text-xs text-gray-400">
                                {doc.is_verified
                                  ? "Verified"
                                  : "Pending verification"}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {pendingIdentityUpload && (
                      <div className="flex items-center justify-between p-3 border border-blue-200 rounded-lg bg-blue-50">
                        <div className="overflow-hidden">
                          <p className="text-sm font-semibold text-[#333438] truncate">
                            {pendingIdentityUpload.file.name}
                          </p>
                          <p className="text-xs text-[#61636c] capitalize">
                            Queued:{" "}
                            {pendingIdentityUpload.type.replace("_", " ")}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPendingIdentityUpload(null)}
                          className="text-xs font-medium text-red-600 hover:text-red-500"
                        >
                          Remove
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => setIdentityModalOpen(true)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-[#3b82f6] hover:text-[#3b82f6] hover:bg-blue-50 transition-all"
                    >
                      Add identity document
                    </button>

                    {totalIdentityCount === 0 && (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        Upload at least one identity document to continue.
                      </p>
                    )}
                  </div>
                </motion.div>
              )}

              {currentStep === 6 && (
                <motion.div
                  key="s6"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="space-y-6"
                >
                  <div className="border-t border-gray-100 pt-2">
                    <p className="text-sm font-bold text-[#333438] mb-4">
                      Activation Summary
                    </p>
                    <div className="bg-white border border-gray-200 shadow-sm rounded-xl p-5 space-y-2">
                      <ReviewRow
                        label="Name"
                        value={
                          profile.display_name ||
                          `${profile.first_name} ${profile.last_name}`
                        }
                      />
                      <ReviewRow
                        label="Availability"
                        value={availability.replace("_", " ")}
                      />
                      <ReviewRow
                        label="Hourly Rate"
                        value={`$${hourlyRate} ${currency}`}
                      />
                      <ReviewRow
                        label="Weekly Hours"
                        value={`${weeklyHours} hrs/week`}
                      />
                      <ReviewRow
                        label="Specialization"
                        value={
                          specCategory === "other"
                            ? "Other"
                            : SPECIALIZATION_CATEGORIES.find(
                                (c) => c.value === specCategory,
                              )?.label || specCategory
                        }
                      />
                      <ReviewRow
                        label="Total Skills"
                        value={selectedSkillIds.length}
                      />
                      <ReviewRow
                        label="Identity Docs"
                        value={totalIdentityCount}
                      />
                    </div>
                    <p className="text-xs text-[#61636c] mt-4 leading-relaxed">
                      By clicking "Go Live", your profile will instantly become
                      visible to consultants looking to hire freelancers on this
                      platform. Ensure your details are accurate.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Fixed bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none pb-8 pt-4 bg-linear-to-t from-[#f6f7f8] via-[#f6f7f8]/90 to-transparent">
        <div className="max-w-[1440px] mx-auto px-6 flex justify-between">
          <button
            onClick={() => setCurrentStep((s) => Math.max(s - 1, 1))}
            disabled={currentStep === 1 || isSaving}
            className="pointer-events-auto cursor-pointer px-8 py-3 text-[#3b82f6] border border-[#3b82f6] bg-white rounded-lg font-semibold hover:bg-blue-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            Back
          </button>
          {currentStep < 6 ? (
            <button
              onClick={saveCurrentStep}
              disabled={isSaving}
              className="pointer-events-auto cursor-pointer px-8 py-3 bg-linear-to-r from-[#3b82f6] to-[#2563eb] text-white rounded-lg font-semibold hover:shadow-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              Next
            </button>
          ) : (
            <button
              onClick={saveCurrentStep}
              disabled={isSaving}
              className="pointer-events-auto cursor-pointer px-8 py-3 bg-linear-to-r from-[#8b5cf6] to-[#7c3aed] text-white rounded-lg font-semibold hover:shadow-lg hover:shadow-violet-500/30 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" /> Processing...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5" /> Go Live Now
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Success Modal */}
      <ModalPortal>
      <AnimatePresence>
        {showSuccessModal && (
          <motion.div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => {
                setShowSuccessModal(false);
                navigate({ to: "/dashboard" });
              }}
            />
            <motion.div
              className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full p-8 text-center"
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-[#3b82f6]" />
              </div>
              <h2 className="text-3xl font-bold text-gray-900 mb-2">
                You're Live!
              </h2>
              <p className="text-gray-600 mb-1">
                Your freelancer profile is now active on the platform.
              </p>
              <p className="text-sm text-gray-400 mb-8">
                Consultants can now discover your profile and match you with
                their projects based on your skills and availability.
              </p>
              <button
                onClick={() => {
                  setShowSuccessModal(false);
                  navigate({ to: "/dashboard" });
                }}
                className="px-8 py-3 bg-gradient-to-r from-[#3b82f6] to-[#2563eb] text-white rounded-lg font-semibold hover:shadow-lg transition-all w-full"
              >
                Go to Dashboard
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </ModalPortal>

      <IdentityDocumentModal
        isOpen={identityModalOpen}
        onClose={() => setIdentityModalOpen(false)}
        onSave={(payload, file) => {
          setPendingIdentityUpload({
            type: payload.type as IdentityDocumentType,
            file,
          });
          setIdentityModalOpen(false);
        }}
        isSaving={false}
      />

      <PortfolioModal
        isOpen={portfolioModalOpen}
        onClose={() => {
          setPortfolioModalOpen(false);
          setEditingPortfolio(null);
        }}
        initialData={editingPortfolio ?? undefined}
        onSave={(payload) => {
          if (editingPortfolio) {
            updatePortfolioMutation.mutate({
              id: editingPortfolio.id,
              payload,
            });
            return;
          }
          addPortfolioMutation.mutate(payload as any);
        }}
        isSaving={
          editingPortfolio
            ? updatePortfolioMutation.isPending
            : addPortfolioMutation.isPending
        }
        nextPosition={profile.portfolios.length}
      />
    </div>
  );
}
