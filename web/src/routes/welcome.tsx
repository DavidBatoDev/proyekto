import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Plus,
  Sparkles,
  Trash2,
  Users,
  Wallet,
  Workflow,
  X,
} from "lucide-react";
import { Button } from "@/ui/button";
import { useAuthStore } from "@/stores/authStore";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { supabase } from "@/lib/supabase";
import { apiClient } from "@/api";
import { useToast } from "@/hooks/useToast";

export const Route = createFileRoute("/welcome")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState();
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/auth/login" });
    }
  },
  component: WelcomePage,
});

// ─── Page shell ─────────────────────────────────────────────────────────────

function WelcomePage() {
  const { isLoading: profileLoading } = useProfileQuery();
  const profile = useAuthStore((s) => s.profile);

  if (!profile || profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fcfcfd]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" />
      </div>
    );
  }

  const lane =
    (profile.settings as { onboarding?: { lane?: string } } | null)?.onboarding
      ?.lane ?? "client_freelancer";
  const firstName =
    (profile.first_name as string | undefined) ||
    profile.display_name ||
    "there";

  return <UnifiedWelcomeDeck firstName={firstName} lane={lane} />;
}

// ─── Types ───────────────────────────────────────────────────────────────────

type TeamInviteRole = "admin" | "member";

interface InviteRow {
  id: string;
  email: string;
  role: TeamInviteRole;
}

function newInviteRow(): InviteRow {
  return { id: crypto.randomUUID(), email: "", role: "member" };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// ─── Unified 4-slide deck ────────────────────────────────────────────────────

function UnifiedWelcomeDeck({
  firstName,
  lane,
}: {
  firstName: string;
  lane: string;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const user = useAuthStore((s) => s.user);

  // ── Team lookup ──────────────────────────────────────────────────────────
  const [teamId, setTeamId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState<string>("");
  const [teamLoadFailed, setTeamLoadFailed] = useState(false);

  // ── Workspace lookup ─────────────────────────────────────────────────────
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceTitle, setWorkspaceTitle] = useState<string>("");
  const [workspaceLoadFailed, setWorkspaceLoadFailed] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    (async () => {
      let [teamRes, workspaceRes] = await Promise.all([
        supabase
          .from("teams")
          .select("id, name")
          .eq("owner_id", user.id)
          .eq("is_personal", true)
          .maybeSingle(),
        supabase
          .from("projects")
          .select("id, title")
          .eq("client_id", user.id)
          .eq("is_personal_workspace", true)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      // If either artifact is missing (e.g. existing users from before the
      // unified provisioning change), trigger a backend provision call which
      // idempotently creates both, then re-query.
      const needsProvision =
        (!teamRes.error && !teamRes.data) ||
        (!workspaceRes.error && !workspaceRes.data);

      if (needsProvision) {
        try {
          await apiClient.post("/api/auth/provision", {});
          [teamRes, workspaceRes] = await Promise.all([
            supabase
              .from("teams")
              .select("id, name")
              .eq("owner_id", user.id)
              .eq("is_personal", true)
              .maybeSingle(),
            supabase
              .from("projects")
              .select("id, title")
              .eq("client_id", user.id)
              .eq("is_personal_workspace", true)
              .maybeSingle(),
          ]);
          if (cancelled) return;
        } catch (err) {
          console.error("Failed to provision missing artifacts:", err);
        }
      }

      if (teamRes.error || !teamRes.data) {
        setTeamLoadFailed(true);
      } else {
        setTeamId(teamRes.data.id as string);
        setTeamName((teamRes.data.name as string) ?? "");
      }

      if (workspaceRes.error || !workspaceRes.data) {
        setWorkspaceLoadFailed(true);
      } else {
        setWorkspaceId(workspaceRes.data.id as string);
        setWorkspaceTitle((workspaceRes.data.title as string) ?? "");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // ── Slide state ──────────────────────────────────────────────────────────
  const [slide, setSlide] = useState<1 | 2 | 3 | 4>(1);
  const [direction, setDirection] = useState<1 | -1>(1);
  const goNext = () => {
    if (slide < 4) {
      setDirection(1);
      setSlide(((slide as number) + 1) as 1 | 2 | 3 | 4);
    }
  };
  const goBack = () => {
    if (slide > 1) {
      setDirection(-1);
      setSlide(((slide as number) - 1) as 1 | 2 | 3 | 4);
    }
  };

  // ── Slide 3: team name + invites ─────────────────────────────────────────
  const [draftTeamName, setDraftTeamName] = useState<string>("");
  useEffect(() => {
    setDraftTeamName(teamName);
  }, [teamName]);

  const [teamInvites, setTeamInvites] = useState<InviteRow[]>(() => [
    newInviteRow(),
  ]);
  const [submittingTeam, setSubmittingTeam] = useState(false);

  const addTeamInviteRow = () =>
    setTeamInvites((prev) => [...prev, newInviteRow()]);
  const removeTeamInviteRow = (id: string) =>
    setTeamInvites((prev) =>
      prev.length === 1 ? [newInviteRow()] : prev.filter((r) => r.id !== id),
    );
  const updateTeamInviteRow = (id: string, patch: Partial<InviteRow>) =>
    setTeamInvites((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );

  const saveTeamAndInvites = async () => {
    setSubmittingTeam(true);
    try {
      if (teamId) {
        const trimmed = draftTeamName.trim();
        if (!trimmed) {
          toast.error("Team name can't be empty");
          setSubmittingTeam(false);
          return;
        }
        if (trimmed !== teamName) {
          await apiClient.patch(`/api/teams/${teamId}`, { name: trimmed });
          setTeamName(trimmed);
        }

        const validInvites = teamInvites.filter((r) =>
          isValidEmail(r.email),
        );
        let failures = 0;
        for (const row of validInvites) {
          try {
            await apiClient.post(`/api/teams/${teamId}/invites`, {
              email: row.email.trim(),
              role: row.role,
            });
          } catch {
            failures += 1;
          }
        }
        if (failures > 0) {
          toast.error(
            failures === validInvites.length
              ? "All team invites failed. You can retry from team settings."
              : `${failures} of ${validInvites.length} invites failed.`,
          );
        } else if (validInvites.length > 0) {
          toast.success(
            `${validInvites.length} invite${validInvites.length === 1 ? "" : "s"} sent`,
          );
        }
      }
    } catch (err) {
      console.error("Failed to save team:", err);
      toast.error("Couldn't save team name. Try again.");
      setSubmittingTeam(false);
      return;
    }
    setSubmittingTeam(false);
    goNext();
  };

  // ── Slide 4: project name + attach team ──────────────────────────────────
  const [draftTitle, setDraftTitle] = useState<string>("");
  useEffect(() => {
    setDraftTitle(workspaceTitle);
  }, [workspaceTitle]);

  const [attachTeam, setAttachTeam] = useState(true);
  const [submittingProject, setSubmittingProject] = useState(false);

  const saveProjectAndFinish = async () => {
    setSubmittingProject(true);
    try {
      if (workspaceId) {
        const trimmed = draftTitle.trim();
        if (!trimmed) {
          toast.error("Project name can't be empty");
          setSubmittingProject(false);
          return;
        }
        if (trimmed !== workspaceTitle) {
          await apiClient.patch(`/api/projects/${workspaceId}`, {
            title: trimmed,
          });
        }

        if (attachTeam && teamId) {
          try {
            await apiClient.post(`/api/projects/${workspaceId}/teams`, {
              team_id: teamId,
              is_primary: true,
              members: [],
            });
          } catch (err) {
            console.error("Failed to attach team to project:", err);
            toast.error(
              "Couldn't attach team to project — you can do it from project settings later.",
            );
          }
        }
      }
    } catch (err) {
      console.error("Failed to save project:", err);
      toast.error("Couldn't save project name. Try again.");
      setSubmittingProject(false);
      return;
    }
    setSubmittingProject(false);

    if (lane === "consultant") {
      navigate({ to: "/consultant/apply" });
    } else {
      navigate({ to: "/dashboard" });
    }
  };

  const skipAndFinish = () => {
    if (lane === "consultant") {
      navigate({ to: "/consultant/apply" });
    } else {
      navigate({ to: "/dashboard" });
    }
  };

  // ── Close confirmation ───────────────────────────────────────────────────
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const handleClose = () => {
    if (slide === 1) setShowCloseConfirm(true);
    else goBack();
  };

  const footerNode =
    lane === "consultant" ? (
      <>
        Want to use Proyekto as a client first?{" "}
        <button
          type="button"
          onClick={() => navigate({ to: "/dashboard" })}
          className="font-semibold text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-slate-900 hover:decoration-slate-700"
        >
          Open my workspace →
        </button>
      </>
    ) : (
      <>
        Considering becoming a consultant?{" "}
        <a
          href="/consultant"
          className="font-semibold text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-slate-900 hover:decoration-slate-700"
        >
          Apply to lead →
        </a>
      </>
    );

  return (
    <DeckShell
      stepper={<Stepper current={slide} total={4} onClose={handleClose} />}
      footer={footerNode}
    >
      <AnimatePresence mode="wait" initial={false} custom={direction}>
        {slide === 1 && (
          <SlideWelcome
            key="u-1"
            firstName={firstName}
            onNext={goNext}
            direction={direction}
          />
        )}
        {slide === 2 && (
          <SlideCapabilities
            key="u-2"
            onBack={goBack}
            onNext={goNext}
            direction={direction}
          />
        )}
        {slide === 3 && (
          <SlideTeamSetup
            key="u-3"
            draftTeamName={draftTeamName}
            setDraftTeamName={setDraftTeamName}
            teamLoadFailed={teamLoadFailed}
            invites={teamInvites}
            addInviteRow={addTeamInviteRow}
            removeInviteRow={removeTeamInviteRow}
            updateInviteRow={updateTeamInviteRow}
            onBack={goBack}
            onNext={saveTeamAndInvites}
            submitting={submittingTeam}
            direction={direction}
          />
        )}
        {slide === 4 && (
          <SlideProjectSetup
            key="u-4"
            draftTitle={draftTitle}
            setDraftTitle={setDraftTitle}
            workspaceLoadFailed={workspaceLoadFailed}
            teamName={draftTeamName || teamName}
            attachTeam={attachTeam}
            setAttachTeam={setAttachTeam}
            teamAvailable={!!teamId}
            onBack={goBack}
            onSkip={skipAndFinish}
            onFinish={saveProjectAndFinish}
            submitting={submittingProject}
            direction={direction}
          />
        )}
      </AnimatePresence>

      {showCloseConfirm && (
        <CloseConfirmModal
          title="Skip the welcome tour?"
          description="You can always set up your team and workspace from your dashboard later."
          onCancel={() => setShowCloseConfirm(false)}
          onConfirm={skipAndFinish}
        />
      )}
    </DeckShell>
  );
}

// ─── Slide 1: Welcome ────────────────────────────────────────────────────────

function SlideWelcome({
  firstName,
  onNext,
  direction,
}: {
  firstName: string;
  onNext: () => void;
  direction: 1 | -1;
}) {
  return (
    <motion.div
      custom={direction}
      variants={slideVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={slideTransition}
      className="text-center"
    >
      <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-[0_8px_18px_rgba(15,23,42,0.05)]">
        <Sparkles className="h-6 w-6 text-cyan-600" />
      </div>
      <h1 className="mt-6 text-balance text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
        Welcome to Proyekto, {firstName}.
      </h1>
      <p className="mx-auto mt-3 max-w-md text-balance text-sm text-slate-600 sm:text-base">
        Let's get you set up — should take a minute.
      </p>
      <div className="mt-10 flex justify-center">
        <Button
          variant="contained"
          colorScheme="primary"
          onClick={onNext}
          className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.26)] hover:bg-slate-800"
        >
          Get started
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </motion.div>
  );
}

// ─── Slide 2: Capabilities ───────────────────────────────────────────────────

const capabilities = [
  {
    icon: Sparkles,
    title: "Plan with AI",
    description:
      "Draft a clear roadmap before anyone gets hired. Sharper scope, tighter quotes.",
  },
  {
    icon: Users,
    title: "Build and manage your team",
    description:
      "Invite collaborators, assign roles, and keep everyone aligned in one shared workspace.",
  },
  {
    icon: Wallet,
    title: "Escrow, contracts, invoicing",
    description:
      "Built-in commercial layer. Stop chasing wire transfers and reconciling spreadsheets.",
  },
  {
    icon: Workflow,
    title: "Ship together",
    description:
      "Roadmap, chat, files, and time tracking on one canvas. Pay through escrow on milestones.",
  },
];

function SlideCapabilities({
  onBack,
  onNext,
  direction,
}: {
  onBack: () => void;
  onNext: () => void;
  direction: 1 | -1;
}) {
  return (
    <motion.div
      custom={direction}
      variants={slideVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={slideTransition}
    >
      <h1 className="text-balance text-center text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
        What you can do here
      </h1>
      <p className="mx-auto mt-3 max-w-lg text-center text-balance text-sm text-slate-600 sm:text-base">
        Everything you need to scope, build, and ship — in one place.
      </p>

      <div className="mx-auto mt-8 max-w-xl space-y-3">
        {capabilities.map((cap) => {
          const Icon = cap.icon;
          return (
            <article
              key={cap.title}
              className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_4px_12px_rgba(15,23,42,0.04)]"
            >
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700">
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {cap.title}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">
                  {cap.description}
                </p>
              </div>
            </article>
          );
        })}
      </div>

      <NavRow onBack={onBack} onNext={onNext} nextLabel="Next" />
    </motion.div>
  );
}

// ─── Slide 3: Team setup ─────────────────────────────────────────────────────

function SlideTeamSetup({
  draftTeamName,
  setDraftTeamName,
  teamLoadFailed,
  invites,
  addInviteRow,
  removeInviteRow,
  updateInviteRow,
  onBack,
  onNext,
  submitting,
  direction,
}: {
  draftTeamName: string;
  setDraftTeamName: (v: string) => void;
  teamLoadFailed: boolean;
  invites: InviteRow[];
  addInviteRow: () => void;
  removeInviteRow: (id: string) => void;
  updateInviteRow: (id: string, patch: Partial<InviteRow>) => void;
  onBack: () => void;
  onNext: () => void;
  submitting: boolean;
  direction: 1 | -1;
}) {
  return (
    <motion.div
      custom={direction}
      variants={slideVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={slideTransition}
    >
      <h1 className="text-balance text-center text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
        Set up your team
      </h1>
      <p className="mx-auto mt-3 max-w-lg text-center text-balance text-sm text-slate-600 sm:text-base">
        Give your team a name, then invite anyone you want to collaborate with.
      </p>

      <div className="mx-auto mt-8 max-w-xl space-y-5">
        <div>
          <label
            htmlFor="team-name"
            className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500"
          >
            Team name
          </label>
          <input
            id="team-name"
            type="text"
            value={draftTeamName}
            onChange={(e) => setDraftTeamName(e.target.value)}
            maxLength={120}
            disabled={teamLoadFailed}
            placeholder={teamLoadFailed ? "Loading…" : "My Team"}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 disabled:cursor-wait disabled:opacity-60"
          />
          {teamLoadFailed && (
            <p className="mt-2 text-xs text-amber-700">
              We couldn't load your team just yet. You can still continue — name
              it from your dashboard.
            </p>
          )}
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
            Invite teammates (optional)
          </p>
          <div className="space-y-3">
            {invites.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_4px_12px_rgba(15,23,42,0.04)] sm:flex-nowrap"
              >
                <input
                  type="email"
                  value={row.email}
                  onChange={(e) =>
                    updateInviteRow(row.id, { email: e.target.value })
                  }
                  placeholder="teammate@company.com"
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                />
                <TeamRoleToggle
                  role={row.role}
                  onChange={(role) => updateInviteRow(row.id, { role })}
                />
                <button
                  type="button"
                  onClick={() => removeInviteRow(row.id)}
                  className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Remove invite row"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={addInviteRow}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
            >
              <Plus className="h-4 w-4" />
              Add another
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-10 flex max-w-xl items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:border-slate-900 hover:text-slate-900 disabled:opacity-60"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <Button
          variant="contained"
          colorScheme="primary"
          onClick={onNext}
          disabled={submitting}
          className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.26)] hover:bg-slate-800 disabled:opacity-60"
        >
          {submitting ? "Saving…" : "Next"}
          {!submitting && <ArrowRight className="ml-2 h-4 w-4" />}
        </Button>
      </div>
    </motion.div>
  );
}

// ─── Slide 4: Project setup ──────────────────────────────────────────────────

function SlideProjectSetup({
  draftTitle,
  setDraftTitle,
  workspaceLoadFailed,
  teamName,
  attachTeam,
  setAttachTeam,
  teamAvailable,
  onBack,
  onSkip,
  onFinish,
  submitting,
  direction,
}: {
  draftTitle: string;
  setDraftTitle: (v: string) => void;
  workspaceLoadFailed: boolean;
  teamName: string;
  attachTeam: boolean;
  setAttachTeam: (v: boolean) => void;
  teamAvailable: boolean;
  onBack: () => void;
  onSkip: () => void;
  onFinish: () => void;
  submitting: boolean;
  direction: 1 | -1;
}) {
  return (
    <motion.div
      custom={direction}
      variants={slideVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={slideTransition}
    >
      <h1 className="text-balance text-center text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
        Your project workspace
      </h1>
      <p className="mx-auto mt-3 max-w-lg text-center text-balance text-sm text-slate-600 sm:text-base">
        Name your first project and optionally link your team to it right away.
      </p>

      <div className="mx-auto mt-8 max-w-md space-y-5">
        <div>
          <label
            htmlFor="workspace-title"
            className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500"
          >
            Project name
          </label>
          <input
            id="workspace-title"
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            maxLength={120}
            disabled={workspaceLoadFailed}
            placeholder={workspaceLoadFailed ? "Loading…" : "My Project"}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 disabled:cursor-wait disabled:opacity-60"
          />
          {workspaceLoadFailed && (
            <p className="mt-2 text-xs text-amber-700">
              We couldn't load your project just yet. You can name it from your
              dashboard.
            </p>
          )}
        </div>

        {teamAvailable && (
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_4px_12px_rgba(15,23,42,0.04)] transition-colors hover:border-slate-300">
            <input
              type="checkbox"
              checked={attachTeam}
              onChange={(e) => setAttachTeam(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-slate-900"
            />
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Attach{" "}
                <span className="text-slate-600">
                  {teamName || "my team"}
                </span>{" "}
                to this project
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Your team will have access to this project from the start.
              </p>
            </div>
          </label>
        )}
      </div>

      <div className="mx-auto mt-10 flex max-w-md flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:border-slate-900 hover:text-slate-900 disabled:opacity-60"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onSkip}
            disabled={submitting}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Skip for now
          </button>
          <Button
            variant="contained"
            colorScheme="primary"
            onClick={onFinish}
            disabled={submitting}
            className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.26)] hover:bg-slate-800 disabled:opacity-60"
          >
            {submitting ? "Saving…" : "Finish"}
            {!submitting && <ArrowRight className="ml-2 h-4 w-4" />}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Team role toggle ─────────────────────────────────────────────────────────

function TeamRoleToggle({
  role,
  onChange,
}: {
  role: TeamInviteRole;
  onChange: (role: TeamInviteRole) => void;
}) {
  return (
    <div className="flex shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
      {(["admin", "member"] as TeamInviteRole[]).map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={`rounded-md px-3 py-1.5 transition-colors ${
            role === r
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {r === "admin" ? "Admin" : "Member"}
        </button>
      ))}
    </div>
  );
}

// ─── Shared deck shell ────────────────────────────────────────────────────────

function DeckShell({
  stepper,
  footer,
  children,
}: {
  stepper: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#fcfcfd]">
      <div className="pointer-events-none absolute -top-20 left-[10%] h-72 w-72 rounded-full bg-cyan-200/35 blur-3xl" />
      <div className="pointer-events-none absolute -right-12 top-1/3 h-72 w-72 rounded-full bg-indigo-200/40 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-8 sm:px-6 lg:px-10">
        {stepper}
        <div className="relative mt-12 flex-1">{children}</div>
        <p className="mt-8 text-center text-xs text-slate-500">{footer}</p>
      </div>
    </div>
  );
}

// ─── Stepper ─────────────────────────────────────────────────────────────────

function Stepper({
  current,
  total,
  onClose,
}: {
  current: number;
  total: number;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-1 items-center gap-2">
        {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
          <div
            key={n}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              n <= current ? "bg-slate-900" : "bg-slate-200"
            }`}
          />
        ))}
        <span className="ml-3 shrink-0 text-xs font-semibold text-slate-500">
          {current} of {total}
        </span>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── Slide motion variants ────────────────────────────────────────────────────

const slideVariants = {
  enter: (dir: 1 | -1) => ({ x: dir === 1 ? 24 : -24, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: 1 | -1) => ({ x: dir === 1 ? -24 : 24, opacity: 0 }),
};
const slideTransition = { duration: 0.25, ease: "easeOut" as const };

// ─── Reusable nav row ─────────────────────────────────────────────────────────

function NavRow({
  onBack,
  onNext,
  nextLabel,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel: string;
}) {
  return (
    <div className="mx-auto mt-10 flex max-w-xl items-center justify-between gap-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:border-slate-900 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>
      <Button
        variant="contained"
        colorScheme="primary"
        onClick={onNext}
        className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.26)] hover:bg-slate-800"
      >
        {nextLabel}
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}

// ─── Close confirmation modal ─────────────────────────────────────────────────

function CloseConfirmModal({
  title,
  description,
  confirmLabel = "Skip",
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_24px_48px_rgba(15,23,42,0.25)]">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
          <CheckCircle2 className="h-5 w-5 text-slate-700" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-slate-900">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {description}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-all hover:border-slate-900 hover:text-slate-900"
          >
            Stay
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
