import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Upload,
  Check,
  X,
  Briefcase,
  Loader2,
  MapIcon,
  UserCheck,
  ExternalLink,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { roadmapService } from "@/services/roadmap.service";
import { projectService } from "@/services/project.service";
import type { Roadmap } from "@/types/roadmap";
import { useProfile } from "@/stores/authStore";
import {
  Step1 as SharedStep1,
  Step2 as SharedStep2,
  StepIndicator,
  type FormData as BaseFormData,
} from "@/components/project-brief";
import { ProjectTeamPicker } from "@/components/project-brief/ProjectTeamPicker";

export const Route = createFileRoute("/project-posting")({
  component: ProjectPostingPage,
  validateSearch: (search: Record<string, unknown>) => {
    return {
      roadmapId: (search.roadmapId as string) || undefined,
    };
  },
});

// Extended FormData with Step 3 fields
interface FormData extends BaseFormData {
  // Step 3 additional fields
  roadmapFile: File | null;
  budgetRange: string;
  fundingStatus: string;
  startDate: string;
  customStartDate: string;
}

type ProjectCreationIntent = "client" | "consultant";

function ProjectPostingPage() {
  const navigate = useNavigate();
  const profile = useProfile();
  const searchParams = Route.useSearch();
  const [currentStep, setCurrentStep] = useState(1);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [referencedRoadmap, setReferencedRoadmap] = useState<Roadmap | null>(
    null,
  );
  const [isLoadingRoadmap, setIsLoadingRoadmap] = useState(false);
  const [creationIntent, setCreationIntent] =
    useState<ProjectCreationIntent>("client");
  const [pendingIntent, setPendingIntent] =
    useState<ProjectCreationIntent>("client");
  const [showIntentModal, setShowIntentModal] = useState(false);
  const [hasAutoOpenedIntentModal, setHasAutoOpenedIntentModal] =
    useState(false);
  // Consultant-mode primary team selection. null means either "not yet
  // chosen" (the picker will default-select on load) or the explicit
  // "No team" opt-out — we treat both the same at submit time.
  const [primaryTeamId, setPrimaryTeamId] = useState<string | null>(null);
  const fromRoadmap = Boolean(searchParams.roadmapId);
  const [formData, setFormData] = useState<FormData>({
    title: "",
    category: "",
    description: "",
    problemSolving: "",
    projectState: "idea",
    skills: [],
    customSkills: [],
    duration: "1-3_months",
    roadmapFile: null,
    budgetRange: "< $1,000",
    fundingStatus: "",
    startDate: "immediately",
    customStartDate: "",
  });

  const updateFormData = (updates: Partial<FormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  };

  const isVerifiedConsultant = profile?.is_consultant_verified === true;
  const effectiveIntent: ProjectCreationIntent =
    isVerifiedConsultant && creationIntent === "consultant"
      ? "consultant"
      : "client";

  useEffect(() => {
    if (!isVerifiedConsultant && creationIntent !== "client") {
      setCreationIntent("client");
    }
  }, [isVerifiedConsultant, creationIntent]);

  useEffect(() => {
    if (showIntentModal) {
      setPendingIntent(effectiveIntent);
    }
  }, [showIntentModal, effectiveIntent]);

  useEffect(() => {
    if (isVerifiedConsultant && !hasAutoOpenedIntentModal) {
      setShowIntentModal(true);
      setHasAutoOpenedIntentModal(true);
    }
  }, [isVerifiedConsultant, hasAutoOpenedIntentModal]);

  // Fetch roadmap data if roadmapId is provided
  useEffect(() => {
    const fetchRoadmapData = async () => {
      if (searchParams.roadmapId) {
        setIsLoadingRoadmap(true);
        try {
          const roadmap = await roadmapService.getById(searchParams.roadmapId);
          setReferencedRoadmap(roadmap);

          setFormData((prev) => ({
            ...prev,
            title: roadmap.name || prev.title,
            description: roadmap.description || prev.description,
          }));
          setCurrentStep(1);
        } catch (error) {
          console.error("Failed to fetch roadmap:", error);
        } finally {
          setIsLoadingRoadmap(false);
        }
      }
    };

    fetchRoadmapData();
  }, [searchParams.roadmapId]);

  const nextStep = () => {
    if (currentStep < 3) setCurrentStep(currentStep + 1);
  };

  const prevStep = () => {
    if (currentStep > 1) setCurrentStep(currentStep - 1);
  };

  const handleSubmit = async () => {
    console.log("Project submitted:", formData);
    const projectStatus =
      effectiveIntent === "consultant" ? "draft" : "bidding";

    // If coming from roadmap, create a project immediately and link the roadmap.
    // Intent controls whether this becomes a client bidding project or consultant incubation draft.
    if (fromRoadmap && referencedRoadmap) {
      setIsCreatingProject(true);
      try {
        // Create project with all form data. The backend also creates
        // an empty default roadmap atomically — we immediately replace
        // it with the referenced one so the auto-created draft is
        // discarded.
        const { project } = await projectService.create({
          creation_mode: effectiveIntent,
          title: formData.title || "Untitled Project",
          description: formData.description,
          category: formData.category,
          project_state: formData.projectState,
          skills: [...formData.skills, ...formData.customSkills],
          duration: formData.duration,
          budget_range: formData.budgetRange,
          funding_status: formData.fundingStatus,
          start_date: formData.startDate,
          custom_start_date: formData.customStartDate || undefined,
          status: projectStatus,
          primary_team_id:
            effectiveIntent === "consultant" && primaryTeamId
              ? primaryTeamId
              : undefined,
        });

        console.log("Project created from roadmap:", project);

        await roadmapService.replaceProjectRoadmap(
          project.id,
          referencedRoadmap.id,
        );

        navigate({
          to: "/project/$projectId/roadmap/$roadmapId",
          params: { projectId: project.id, roadmapId: referencedRoadmap.id },
        });
      } catch (error) {
        console.error("Failed to create project:", error);
        // Could add error toast here
      } finally {
        setIsCreatingProject(false);
      }
    } else {
      setIsCreatingProject(true);
      try {
        const { project, roadmap } = await projectService.create({
          creation_mode: effectiveIntent,
          title: formData.title || "Untitled Project",
          description: formData.description,
          category: formData.category,
          project_state: formData.projectState,
          skills: [...formData.skills, ...formData.customSkills],
          duration: formData.duration,
          budget_range: formData.budgetRange,
          funding_status: formData.fundingStatus,
          start_date: formData.startDate,
          custom_start_date: formData.customStartDate || undefined,
          status: projectStatus,
          primary_team_id:
            effectiveIntent === "consultant" && primaryTeamId
              ? primaryTeamId
              : undefined,
        });

        console.log("Project created from project posting:", project);
        navigate({
          to: "/project/$projectId/roadmap/$roadmapId",
          params: { projectId: project.id, roadmapId: roadmap.id },
        });
      } catch (error) {
        console.error("Failed to create project:", error);
      } finally {
        setIsCreatingProject(false);
      }
    }
  };

  return (
    <div className="app-shell-bg min-h-screen">
      {/* Minimal top bar — back-out + intent toggle, no global header */}
      <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between px-5 py-3 md:px-10">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </Link>
          <p className="hidden text-sm font-semibold text-slate-900 sm:block">
            New project
          </p>
          {isVerifiedConsultant ? (
            <button
              type="button"
              onClick={() => setShowIntentModal(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
            >
              <Briefcase className="h-3.5 w-3.5 text-slate-500" />
              {effectiveIntent === "client"
                ? "Creating as client"
                : "Creating as consultant"}
            </button>
          ) : (
            <span className="w-[88px]" aria-hidden="true" />
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1240px] px-5 py-10 pb-40 md:px-10">

        {/* Progress Stepper */}
        <div className="mb-12 flex items-center justify-center">
          <StepIndicator
            step={1}
            currentStep={currentStep}
            label="Vision & Scope"
            totalSteps={3}
          />
          <StepperBar filled={currentStep > 1} />
          <StepIndicator
            step={2}
            currentStep={currentStep}
            label="Skills & Duration"
            totalSteps={3}
          />
          <StepperBar filled={currentStep > 2} />
          <StepIndicator
            step={3}
            currentStep={currentStep}
            label="Budget & Timeline"
            totalSteps={3}
          />
        </div>

        {/* Step Content */}
        <div className="grid grid-cols-[400px_1fr] gap-12">
          {/* Left Side - Step Info */}
          <div className="relative">
            <div className="sticky top-[120px]">
              <AnimatePresence mode="wait">
                {currentStep === 1 && (
                  <motion.div
                    key="step1-info"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                  >
                    <h1 className="mb-4 text-4xl font-bold tracking-tight text-slate-900">
                      Step 1: Vision &<br />
                      Scope
                    </h1>
                    <p className="text-base text-slate-600">
                      Tell us what you want to build. You can either answer a
                      few questions or upload an existing RFP/Brief.
                    </p>
                  </motion.div>
                )}
                {currentStep === 2 && (
                  <motion.div
                    key="step2-info"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                  >
                    <h1 className="mb-4 text-4xl font-bold tracking-tight text-slate-900">
                      Step 2: Skills &<br />
                      Deliverables
                    </h1>
                    <p className="text-base text-slate-600">
                      Define the expertise you need and the results you expect.
                    </p>
                  </motion.div>
                )}
                {currentStep === 3 && (
                  <motion.div
                    key="step3-info"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                  >
                    <h1 className="mb-4 text-4xl font-bold tracking-tight text-slate-900">
                      Step 3: Budget &<br />
                      Timeline
                    </h1>
                    <p className="text-base text-slate-600">
                      {effectiveIntent === "consultant"
                        ? "Set budget and timing for the project you're leading. You can adjust these later when you transfer it to a client."
                        : "Help us match you with consultants who fit your financial and schedule goals."}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Right Side - Form */}
          <div className="min-h-[500px]">
            <AnimatePresence mode="wait">
              {currentStep === 1 && (
                <motion.div
                  key="step1-form"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                >
                  <SharedStep1
                    formData={formData}
                    updateFormData={updateFormData}
                  />
                </motion.div>
              )}
              {currentStep === 2 && (
                <motion.div
                  key="step2-form"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                >
                  <SharedStep2
                    formData={formData}
                    updateFormData={updateFormData}
                  />
                </motion.div>
              )}
              {currentStep === 3 && (
                <motion.div
                  key="step3-form"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                >
                  <Step3
                    formData={formData}
                    updateFormData={updateFormData}
                    referencedRoadmap={referencedRoadmap}
                  />
                  {effectiveIntent === "consultant" && (
                    <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                      <ProjectTeamPicker
                        value={primaryTeamId}
                        onChange={setPrimaryTeamId}
                      />
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Navigation Buttons */}
        <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-40 bg-linear-to-t from-white via-white/80 to-transparent pb-8 pt-6">
          <div className="mx-auto flex max-w-[1240px] justify-between px-5 md:px-10">
            <button
              onClick={prevStep}
              disabled={currentStep === 1}
              className="pointer-events-auto cursor-pointer rounded-lg border border-slate-200 bg-white px-6 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Back
            </button>
            {currentStep < 3 ? (
              <button
                onClick={nextStep}
                className="pointer-events-auto cursor-pointer rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={isCreatingProject}
                className="pointer-events-auto inline-flex cursor-pointer items-center gap-2 rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCreatingProject ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Submit project
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Intent Modal */}
      <AnimatePresence>
        {isVerifiedConsultant && showIntentModal && (
          <motion.div
            className="fixed inset-0 z-9998 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="absolute inset-0 bg-[#201913]/55 backdrop-blur-md"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowIntentModal(false)}
            />
            <motion.div
              className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.96 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              <div className="relative p-6 md:p-8">
                <div className="mb-6 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
                      How are you creating this project?
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm text-slate-600 md:text-base">
                      Pick whether you're creating it as the client (you want
                      to hire a consultant to deliver) or as a consultant
                      (you'll lead the work yourself, optionally for a client
                      later). This controls visibility, ownership, and who
                      gets matched.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowIntentModal(false)}
                    className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                    aria-label="Close intent modal"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <IntentOptionCard
                    icon={Briefcase}
                    title="Creating as a client"
                    description="You want to hire a verified consultant to lead delivery."
                    bullets={[
                      "Posted publicly so consultants can apply",
                      "We match you with vetted professionals",
                      "You stay the project owner; the consultant runs execution",
                    ]}
                    selected={pendingIntent === "client"}
                    onSelect={() => setPendingIntent("client")}
                  />
                  <IntentOptionCard
                    icon={UserCheck}
                    title="Creating as a consultant"
                    description="You'll lead the work yourself — alone or with your team — and optionally hand it off to a client later."
                    bullets={[
                      "Starts as a private draft owned by you",
                      "You can attach your team as the primary delivery team",
                      "Transfer ownership to a client whenever you're ready",
                    ]}
                    selected={pendingIntent === "consultant"}
                    onSelect={() => setPendingIntent("consultant")}
                  />
                </div>

                <div className="mt-6 flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">
                    You can reopen this anytime from the "Creating as…"
                    button at the top of the page.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setCreationIntent(pendingIntent);
                      setShowIntentModal(false);
                    }}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                  >
                    Continue
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading Modal for Pre-populating */}
      <AnimatePresence>
        {isLoadingRoadmap && (
          <motion.div
            className="fixed inset-0 z-9999 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.div
              className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-8"
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              <div className="text-center">
                <div className="w-16 h-16 bg-linear-to-br from-orange-100 to-orange-200 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Loader2 className="w-8 h-8 text-orange-600 animate-spin" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-3">
                  Loading Roadmap Data
                </h2>
                <p className="text-gray-600">
                  Pre-populating Steps 1 and 2 from your roadmap...
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function IntentOptionCard({
  icon: Icon,
  title,
  description,
  bullets,
  selected,
  onSelect,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  bullets: string[];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded-xl border p-5 text-left transition-all ${
        selected
          ? "border-slate-900 bg-slate-50 shadow-sm"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <div className="mb-3 flex items-center gap-3">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-lg ${
            selected ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
          }`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {selected && (
          <span className="ml-auto rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            Selected
          </span>
        )}
      </div>
      <p className="mb-3 text-sm text-slate-600">{description}</p>
      <ul className="space-y-1 text-xs text-slate-500">
        {bullets.map((b) => (
          <li key={b}>• {b}</li>
        ))}
      </ul>
    </button>
  );
}

/**
 * Slate stepper bar between StepIndicator dots. Filled = previous step
 * complete, otherwise muted slate-200.
 */
function StepperBar({ filled }: { filled: boolean }) {
  return (
    <div className="-mt-6 mx-2 h-1 w-32 overflow-hidden rounded-full bg-slate-200">
      <motion.div
        className="h-full bg-slate-900"
        initial={{ width: "0%" }}
        animate={{ width: filled ? "100%" : "0%" }}
        transition={{ duration: 0.5, ease: "easeInOut" }}
      />
    </div>
  );
}

function Step3({
  formData,
  updateFormData,
  referencedRoadmap,
}: {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  referencedRoadmap: Roadmap | null;
}) {
  return (
    <div className="space-y-6">
      {/* Budget Range (repeated from Step 2) */}
      <div>
        <label className="block text-sm font-semibold text-[#333438] mb-4">
          Estimated Budget Range*
        </label>
        <div className="grid grid-cols-2 gap-4">
          <TileOption
            name="budgetRange"
            value="< $1,000"
            label="< $1,000"
            checked={formData.budgetRange === "< $1,000"}
            onChange={() => updateFormData({ budgetRange: "< $1,000" })}
          />
          <TileOption
            name="budgetRange"
            value="$1k - $5k"
            label="$1k - $5k"
            checked={formData.budgetRange === "$1k - $5k"}
            onChange={() => updateFormData({ budgetRange: "$1k - $5k" })}
          />
          <TileOption
            name="budgetRange"
            value="$10k - $50k"
            label="$10k - $50k"
            checked={formData.budgetRange === "$10k - $50k"}
            onChange={() => updateFormData({ budgetRange: "$10k - $50k" })}
          />
          <TileOption
            name="budgetRange"
            value="$50k+"
            label="$50k+"
            checked={formData.budgetRange === "$50k+"}
            onChange={() => updateFormData({ budgetRange: "$50k+" })}
          />
          <div className="flex items-center px-4 py-3 bg-white border border-gray-200 rounded-xl shadow-sm hover:border-[#ff9933] transition-colors col-span-2">
            <input
              type="radio"
              name="budgetRange"
              checked={formData.budgetRange === "custom"}
              onChange={() => updateFormData({ budgetRange: "custom" })}
              className="w-5 h-5 text-[#ff9933] focus:ring-[#ff9933]"
            />
            <input
              type="text"
              placeholder="Enter Custom Amount"
              className="ml-3 flex-1 px-3 py-2 border-b border-gray-200 focus:outline-none focus:border-[#ff9933]"
            />
          </div>
        </div>
      </div>
      {/* Funding Status */}
      <div>
        <label className="block text-sm font-semibold text-[#333438] mb-2">
          Funding Status
        </label>
        <select
          value={formData.fundingStatus}
          onChange={(e) => updateFormData({ fundingStatus: e.target.value })}
          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff9933] focus:border-transparent shadow-sm"
        >
          <option value="">Select...</option>
          <option value="self-funded">Self-funded</option>
          <option value="seed">Seed Round</option>
          <option value="series-a">Series A</option>
          <option value="series-b">Series B+</option>
          <option value="bootstrapped">Bootstrapped</option>
        </select>
      </div>
      {/* Start Date */}
      <div>
        <label className="block text-sm font-semibold text-[#333438] mb-4">
          When do you want to start?*
        </label>
        <div className="grid grid-cols-3 gap-4">
          <TileOption
            name="startDate"
            value="immediately"
            label="Immediately"
            checked={formData.startDate === "immediately"}
            onChange={() => updateFormData({ startDate: "immediately" })}
          />
          <TileOption
            name="startDate"
            value="within-month"
            label="Within a month"
            checked={formData.startDate === "within-month"}
            onChange={() => updateFormData({ startDate: "within-month" })}
          />
          <div className="flex items-center px-4 py-2 bg-white border border-gray-200 rounded-xl shadow-sm hover:border-[#ff9933] transition-colors">
            <input
              type="radio"
              name="startDate"
              checked={formData.startDate === "custom"}
              onChange={() => updateFormData({ startDate: "custom" })}
              className="w-5 h-5 text-[#ff9933] focus:ring-[#ff9933]"
            />
            <input
              type="date"
              value={formData.customStartDate}
              onChange={(e) => {
                updateFormData({
                  startDate: "custom",
                  customStartDate: e.target.value,
                });
              }}
              className="ml-3 flex-1 px-2 py-1 border-b border-gray-200 focus:outline-none focus:border-[#ff9933] text-sm"
              placeholder="DD/MM/YY"
            />
          </div>
        </div>
      </div>
      {/* Roadmap Upload or Reference */}
      <div>
        <label className="block text-sm font-semibold text-[#333438] mb-2">
          Do you have an existing Roadmap or Timeline? (Optional)
        </label>
        {referencedRoadmap ? (
          // Show roadmap reference when coming from roadmap
          <div className="border-2 border-orange-300 bg-orange-50 rounded-lg p-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center shrink-0">
                <MapIcon className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-gray-900 mb-1">
                  Linked Roadmap
                </h4>
                <p className="text-sm text-gray-600 mb-3">
                  This project is based on your roadmap:{" "}
                  <span className="font-semibold">
                    "{referencedRoadmap.name}"
                  </span>
                </p>
                <a
                  href={`/project/n/roadmap/${referencedRoadmap.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-orange-600 hover:text-orange-700 font-medium"
                >
                  View Roadmap
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        ) : (
          // Show file upload when not coming from roadmap
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
            <p className="text-[#61636c] mb-1">
              <span className="text-[#ff9933] font-semibold cursor-pointer hover:underline">
                Link
              </span>{" "}
              or drag and drop
            </p>
            <p className="text-xs text-[#92969f]">
              SVG, PNG, JPG or GIF (max. 3MB)
            </p>
            <p className="text-xs text-[#92969f] mt-2 italic">
              Attach Project Schedule or Gantt Chart (PDF, Excel)
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function TileOption({
  name,
  value,
  label,
  description,
  checked,
  onChange,
}: {
  name: string;
  value: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`relative flex items-start p-4 rounded-xl border-2 transition-all cursor-pointer ${
        checked
          ? "bg-[#fff5eb] border-[#ff9933] shadow-md"
          : "bg-white border-gray-200 hover:border-gray-300 shadow-sm"
      }`}
    >
      <div className="flex items-center h-5">
        <input
          type="radio"
          name={name}
          value={value}
          checked={checked}
          onChange={onChange}
          className="w-5 h-5 text-[#ff9933] focus:ring-[#ff9933]"
        />
      </div>
      <div className="ml-3 text-sm">
        <span
          className={`font-semibold block ${checked ? "text-[#333438]" : "text-[#61636c]"}`}
        >
          {label}
        </span>
        {description && (
          <span className="text-xs text-[#92969f] mt-1 block">
            {description}
          </span>
        )}
      </div>
    </label>
  );
}
