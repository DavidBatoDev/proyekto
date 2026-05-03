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
  Workflow,
  X,
} from "lucide-react";
import { Button } from "@/ui/button";
import { useAuthStore } from "@/stores/authStore";
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

type InviteRole = "editor" | "viewer";

interface InviteRow {
  id: string;
  email: string;
  role: InviteRole;
}

function newInviteRow(): InviteRow {
  return { id: crypto.randomUUID(), email: "", role: "editor" };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function WelcomePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const profile = useAuthStore((s) => s.profile);
  const user = useAuthStore((s) => s.user);

  // Lane-aware redirect: consultants don't get the welcome deck.
  const lane =
    (profile?.settings as { onboarding?: { lane?: string } } | null)?.onboarding
      ?.lane ?? "client_freelancer";

  useEffect(() => {
    if (lane === "consultant") {
      navigate({ to: "/consultant/apply" });
    }
  }, [lane, navigate]);

  // ── Workspace lookup ─────────────────────────────────────────────────────
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceTitle, setWorkspaceTitle] = useState<string>("");
  const [workspaceLoadFailed, setWorkspaceLoadFailed] = useState(false);

  useEffect(() => {
    if (!user?.id || lane === "consultant") return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, title")
        .eq("client_id", user.id)
        .eq("is_personal_workspace", true)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setWorkspaceLoadFailed(true);
        return;
      }
      setWorkspaceId(data.id as string);
      setWorkspaceTitle((data.title as string) ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, lane]);

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

  // ── Slide 3: workspace name ──────────────────────────────────────────────
  const [draftTitle, setDraftTitle] = useState<string>("");
  useEffect(() => {
    setDraftTitle(workspaceTitle);
  }, [workspaceTitle]);

  const persistTitleIfChanged = async () => {
    if (!workspaceId) return;
    const trimmed = draftTitle.trim();
    if (!trimmed) {
      toast.error("Workspace name can't be empty");
      throw new Error("empty title");
    }
    if (trimmed === workspaceTitle) return;
    try {
      await apiClient.patch(`/api/projects/${workspaceId}`, { title: trimmed });
      setWorkspaceTitle(trimmed);
    } catch (err) {
      console.error("Failed to rename workspace:", err);
      toast.error("Couldn't save the workspace name. Try again.");
      throw err;
    }
  };

  // ── Slide 4: invites ─────────────────────────────────────────────────────
  const [invites, setInvites] = useState<InviteRow[]>(() => [newInviteRow()]);
  const [submittingInvites, setSubmittingInvites] = useState(false);

  const addInviteRow = () =>
    setInvites((prev) => [...prev, newInviteRow()]);
  const removeInviteRow = (id: string) =>
    setInvites((prev) =>
      prev.length === 1 ? [newInviteRow()] : prev.filter((r) => r.id !== id),
    );
  const updateInviteRow = (id: string, patch: Partial<InviteRow>) =>
    setInvites((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );

  const sendInvitesAndFinish = async () => {
    if (!workspaceId) {
      toast.error("Your workspace isn't ready yet. Try again in a moment.");
      return;
    }
    setSubmittingInvites(true);
    const valid = invites.filter((r) => isValidEmail(r.email));
    let failures = 0;
    for (const row of valid) {
      try {
        await apiClient.post(`/api/projects/${workspaceId}/invites`, {
          email: row.email.trim(),
          default_role: row.role,
          role: "member",
        });
      } catch (err) {
        failures += 1;
        console.error(`Invite for ${row.email} failed:`, err);
      }
    }
    setSubmittingInvites(false);
    if (failures > 0) {
      toast.error(
        failures === valid.length
          ? "All invites failed. You can retry from the workspace settings later."
          : `${failures} of ${valid.length} invites failed.`,
      );
    } else if (valid.length > 0) {
      toast.success(`${valid.length} invite${valid.length === 1 ? "" : "s"} sent`);
    }
    navigate({ to: "/dashboard" });
  };

  const skipInvitesAndFinish = () => navigate({ to: "/dashboard" });

  // ── Slide 1: close confirmation ──────────────────────────────────────────
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const handleClose = () => {
    if (slide === 1) setShowCloseConfirm(true);
    else goBack();
  };

  const firstName =
    (profile?.first_name as string | undefined) ||
    profile?.display_name ||
    "there";

  return (
    <div className="min-h-screen bg-[#fcfcfd]">
      <div className="pointer-events-none absolute -top-20 left-[10%] h-72 w-72 rounded-full bg-cyan-200/35 blur-3xl" />
      <div className="pointer-events-none absolute -right-12 top-1/3 h-72 w-72 rounded-full bg-indigo-200/40 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-8 sm:px-6 lg:px-10">
        <Stepper current={slide} onClose={handleClose} />

        <div className="relative mt-12 flex-1">
          <AnimatePresence mode="wait" initial={false} custom={direction}>
            {slide === 1 && (
              <SlideOne
                key="slide-1"
                firstName={firstName}
                onNext={goNext}
                direction={direction}
              />
            )}
            {slide === 2 && (
              <SlideTwo
                key="slide-2"
                onBack={goBack}
                onNext={goNext}
                direction={direction}
              />
            )}
            {slide === 3 && (
              <SlideThree
                key="slide-3"
                draftTitle={draftTitle}
                setDraftTitle={setDraftTitle}
                onBack={goBack}
                onNext={async () => {
                  try {
                    await persistTitleIfChanged();
                    goNext();
                  } catch {
                    /* toast already shown */
                  }
                }}
                workspaceLoadFailed={workspaceLoadFailed}
                direction={direction}
              />
            )}
            {slide === 4 && (
              <SlideFour
                key="slide-4"
                invites={invites}
                addInviteRow={addInviteRow}
                removeInviteRow={removeInviteRow}
                updateInviteRow={updateInviteRow}
                onBack={goBack}
                onSkip={skipInvitesAndFinish}
                onFinish={sendInvitesAndFinish}
                submittingInvites={submittingInvites}
                direction={direction}
              />
            )}
          </AnimatePresence>
        </div>

        <p className="mt-8 text-center text-xs text-slate-500">
          Considering becoming a consultant?{" "}
          <a
            href="/consultant"
            className="font-semibold text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-slate-900 hover:decoration-slate-700"
          >
            Apply to lead →
          </a>
        </p>
      </div>

      {showCloseConfirm && (
        <CloseConfirmModal
          onCancel={() => setShowCloseConfirm(false)}
          onConfirm={() => navigate({ to: "/dashboard" })}
        />
      )}
    </div>
  );
}

// ─── Stepper ────────────────────────────────────────────────────────────────

function Stepper({
  current,
  onClose,
}: {
  current: 1 | 2 | 3 | 4;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-1 items-center gap-2">
        {[1, 2, 3, 4].map((n) => (
          <div
            key={n}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              n <= current ? "bg-slate-900" : "bg-slate-200"
            }`}
          />
        ))}
        <span className="ml-3 shrink-0 text-xs font-semibold text-slate-500">
          {current} of 4
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

// ─── Slide motion variants ──────────────────────────────────────────────────

const slideVariants = {
  enter: (dir: 1 | -1) => ({ x: dir === 1 ? 24 : -24, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: 1 | -1) => ({ x: dir === 1 ? -24 : 24, opacity: 0 }),
};
const slideTransition = { duration: 0.25, ease: "easeOut" as const };

// ─── Slide 1: Welcome ───────────────────────────────────────────────────────

function SlideOne({
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

// ─── Slide 2: Capabilities ──────────────────────────────────────────────────

const capabilities = [
  {
    icon: Sparkles,
    title: "Plan with AI",
    description:
      "Draft a clear roadmap before anyone gets hired. Sharper scope, tighter quotes.",
  },
  {
    icon: Users,
    title: "Bring in a vetted consultant",
    description:
      "When you're ready, request a vetted lead. They scope, price, and propose a team within 48 hours.",
  },
  {
    icon: Workflow,
    title: "Ship together in one workspace",
    description:
      "Roadmap, chat, files, and time tracking on one canvas. Pay through escrow on milestones.",
  },
];

function SlideTwo({
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
        Three things Proyekto does well — so you don't have to juggle five tools.
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

// ─── Slide 3: Workspace name ────────────────────────────────────────────────

function SlideThree({
  draftTitle,
  setDraftTitle,
  onBack,
  onNext,
  workspaceLoadFailed,
  direction,
}: {
  draftTitle: string;
  setDraftTitle: (v: string) => void;
  onBack: () => void;
  onNext: () => void;
  workspaceLoadFailed: boolean;
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
        Your workspace is ready
      </h1>
      <p className="mx-auto mt-3 max-w-lg text-center text-balance text-sm text-slate-600 sm:text-base">
        Give it a name that fits how you'll use it. You can change it anytime.
      </p>

      <div className="mx-auto mt-8 max-w-md">
        <label
          htmlFor="workspace-title"
          className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500"
        >
          Workspace name
        </label>
        <input
          id="workspace-title"
          type="text"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          maxLength={120}
          disabled={workspaceLoadFailed}
          placeholder={workspaceLoadFailed ? "Loading…" : "My Workspace"}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 disabled:cursor-wait disabled:opacity-60"
        />
        {workspaceLoadFailed && (
          <p className="mt-2 text-xs text-amber-700">
            We couldn't load your workspace just yet. You can still continue —
            we'll save the name on the next step.
          </p>
        )}
      </div>

      <NavRow onBack={onBack} onNext={onNext} nextLabel="Next" />
    </motion.div>
  );
}

// ─── Slide 4: Invite ────────────────────────────────────────────────────────

function SlideFour({
  invites,
  addInviteRow,
  removeInviteRow,
  updateInviteRow,
  onBack,
  onSkip,
  onFinish,
  submittingInvites,
  direction,
}: {
  invites: InviteRow[];
  addInviteRow: () => void;
  removeInviteRow: (id: string) => void;
  updateInviteRow: (id: string, patch: Partial<InviteRow>) => void;
  onBack: () => void;
  onSkip: () => void;
  onFinish: () => void;
  submittingInvites: boolean;
  direction: 1 | -1;
}) {
  const validCount = invites.filter((r) => isValidEmail(r.email)).length;
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
        Invite your team
      </h1>
      <p className="mx-auto mt-3 max-w-lg text-center text-balance text-sm text-slate-600 sm:text-base">
        Add the people you want collaborating on this workspace. You can skip and add them later.
      </p>

      <div className="mx-auto mt-8 max-w-xl space-y-3">
        {invites.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_4px_12px_rgba(15,23,42,0.04)] sm:flex-nowrap"
          >
            <input
              type="email"
              value={row.email}
              onChange={(e) => updateInviteRow(row.id, { email: e.target.value })}
              placeholder="teammate@company.com"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
            />
            <RoleToggle
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

      <div className="mx-auto mt-10 flex max-w-xl flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:border-slate-900 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onSkip}
            disabled={submittingInvites}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Skip for now
          </button>
          <Button
            variant="contained"
            colorScheme="primary"
            onClick={onFinish}
            disabled={submittingInvites}
            className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.26)] hover:bg-slate-800 disabled:opacity-60"
          >
            {submittingInvites
              ? "Sending…"
              : validCount > 0
                ? `Send ${validCount} invite${validCount === 1 ? "" : "s"} & finish`
                : "Finish"}
            {!submittingInvites && <ArrowRight className="ml-2 h-4 w-4" />}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Role toggle ────────────────────────────────────────────────────────────

function RoleToggle({
  role,
  onChange,
}: {
  role: InviteRole;
  onChange: (role: InviteRole) => void;
}) {
  return (
    <div className="flex shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
      {(["editor", "viewer"] as InviteRole[]).map((r) => (
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
          {r === "editor" ? "Editor" : "Viewer"}
        </button>
      ))}
    </div>
  );
}

// ─── Reusable nav row (Back / Next) ─────────────────────────────────────────

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

// ─── Close confirmation modal ───────────────────────────────────────────────

function CloseConfirmModal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_24px_48px_rgba(15,23,42,0.25)]">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
          <CheckCircle2 className="h-5 w-5 text-slate-700" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-slate-900">
          Skip the welcome tour?
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          You can always come back to set up your workspace later from your
          dashboard.
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
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

