import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ModalPortal } from "@/components/common/ModalPortal";
import {
	ArrowRight,
	ArrowLeft,
	BookOpen,
	Check,
	CheckCircle2,
	Clock,
	Crown,
	Plus,
	Sparkles,
	Trash2,
	UserCheck,
	Users,
	Wallet,
	Workflow,
	X,
} from "lucide-react";
import { Button } from "@/ui/button";
import { featureFlags } from "@/config/featureFlags";
import { useAuthStore } from "@/stores/authStore";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { supabase } from "@/lib/supabase";
import { apiClient } from "@/api";
import { completeOnboarding, type OnboardingLane } from "@/lib/auth-api";
import { clearAuthContinuation } from "@/lib/authContinuation";
import { getPendingProjectFromRoadmap } from "@/lib/guestRoadmapConversion";
import { useToast } from "@/hooks/useToast";
import { useAppearanceStore } from "@/stores/appearanceStore";
import { PRESET_THEMES, THEME_OPTIONS } from "@/theme/presets";
import type { ThemeId } from "@/theme/types";

export const Route = createFileRoute("/welcome")({
	beforeLoad: () => {
		const { isAuthenticated, isLoading } = useAuthStore.getState();
		if (!isLoading && !isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	component: WelcomePage,
});

// ─── Page shell — branches on lane ──────────────────────────────────────────

function WelcomePage() {
	useProfileQuery(); // ensures profile is fetched and synced to the store on fresh loads
	const profile = useAuthStore((s) => s.profile);
	const ensuredCompletionRef = useRef(false);

	// Backstop: anyone who reaches /welcome without onboarding persisted (e.g. the
	// OAuth callback's completion call failed, or a legacy account that got stuck
	// looping here) gets it completed now — idempotently. This flips
	// has_completed_onboarding and provisions the personal workspace the deck
	// itself needs, so the user is never re-trapped on /welcome. Best-effort: the
	// tour renders regardless of the result.
	useEffect(() => {
		if (!profile || ensuredCompletionRef.current) return;
		if (profile.has_completed_onboarding) return;
		ensuredCompletionRef.current = true;
		const lane: OnboardingLane =
			(profile.settings as { onboarding?: { lane?: string } } | null)
				?.onboarding?.lane === "consultant"
				? "consultant"
				: "client_freelancer";
		void completeOnboarding({
			lane,
			intent:
				lane === "consultant"
					? { client: false, freelancer: false }
					: { client: true, freelancer: false },
		}).catch((err) => {
			console.error("Welcome-deck onboarding completion backstop failed:", err);
		});
	}, [profile]);

	// Wait for profile hydration before deciding the lane. Guessing a default
	// here causes a flicker between decks when the user lands on /welcome
	// immediately after signup (profile arrives async via onAuthStateChange).
	if (!profile) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background text-foreground">
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

	if (lane === "consultant") {
		return <ConsultantWelcomeDeck firstName={firstName} />;
	}
	return <ClientFreelancerWelcomeDeck firstName={firstName} />;
}

// ─── Client/Freelancer deck ─────────────────────────────────────────────────

// Ordered step keys. The "theme" step is inserted only when the theme system is
// enabled, so navigation and the stepper total are driven off this array rather
// than a fixed number.
type CFStep = "welcome" | "capabilities" | "workspace" | "theme" | "invite";

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

function navigateAfterWelcome(navigate: ReturnType<typeof useNavigate>) {
	clearAuthContinuation();
	const pending = getPendingProjectFromRoadmap();
	if (pending?.roadmapId) {
		navigate({
			to: "/project/roadmap/convert/$roadmapId",
			params: { roadmapId: pending.roadmapId },
		});
		return;
	}

	navigate({ to: "/dashboard" });
}

function ClientFreelancerWelcomeDeck({ firstName }: { firstName: string }) {
	const navigate = useNavigate();
	const toast = useToast();
	const user = useAuthStore((s) => s.user);

	// ── Workspace lookup ─────────────────────────────────────────────────────
	const [workspaceId, setWorkspaceId] = useState<string | null>(null);
	const [workspaceTitle, setWorkspaceTitle] = useState<string>("");
	const [workspaceLoadFailed, setWorkspaceLoadFailed] = useState(false);

	useEffect(() => {
		if (!user?.id) return;
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
	}, [user?.id]);

	// ── Slide state (ordered; theme step is flag-gated) ──────────────────────
	const steps = useMemo<CFStep[]>(() => {
		const list: CFStep[] = ["welcome", "capabilities", "workspace"];
		if (featureFlags.themeSystem) list.push("theme");
		list.push("invite");
		return list;
	}, []);
	const [index, setIndex] = useState(0);
	const [direction, setDirection] = useState<1 | -1>(1);
	const current = steps[index];
	const goNext = () => {
		if (index < steps.length - 1) {
			setDirection(1);
			setIndex(index + 1);
		}
	};
	const goBack = () => {
		if (index > 0) {
			setDirection(-1);
			setIndex(index - 1);
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

	const addInviteRow = () => setInvites((prev) => [...prev, newInviteRow()]);
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
			toast.success(
				`${valid.length} invite${valid.length === 1 ? "" : "s"} sent`,
			);
		}
		navigateAfterWelcome(navigate);
	};

	const skipInvitesAndFinish = () => navigateAfterWelcome(navigate);

	// ── Close confirmation (only offered from the first slide) ───────────────
	const [showCloseConfirm, setShowCloseConfirm] = useState(false);
	const handleClose = () => {
		if (index === 0) setShowCloseConfirm(true);
		else goBack();
	};

	return (
		<DeckShell
			stepper={
				<Stepper
					current={index + 1}
					total={steps.length}
					onClose={handleClose}
				/>
			}
			footer={
				<>
					Considering becoming a consultant?{" "}
					<a
						href="/consultant"
						className="font-semibold text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-slate-900 hover:decoration-slate-700"
					>
						Apply to lead →
					</a>
				</>
			}
		>
			<AnimatePresence mode="wait" initial={false} custom={direction}>
				{current === "welcome" && (
					<SlideOneCF
						key="cf-1"
						firstName={firstName}
						onNext={goNext}
						direction={direction}
					/>
				)}
				{current === "capabilities" && (
					<SlideTwoCF
						key="cf-2"
						onBack={goBack}
						onNext={goNext}
						direction={direction}
					/>
				)}
				{current === "workspace" && (
					<SlideThreeCF
						key="cf-3"
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
				{current === "theme" && (
					<SlideTheme
						key="cf-theme"
						onBack={goBack}
						onNext={goNext}
						direction={direction}
					/>
				)}
				{current === "invite" && (
					<SlideFourCF
						key="cf-4"
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

			{showCloseConfirm && (
				<CloseConfirmModal
					title="Skip the welcome tour?"
					description="You can always come back to set up your workspace later from your dashboard."
					onCancel={() => setShowCloseConfirm(false)}
					onConfirm={() => navigateAfterWelcome(navigate)}
				/>
			)}
		</DeckShell>
	);
}

// ─── Consultant deck ────────────────────────────────────────────────────────

// Ordered step keys; the "theme" step is flag-gated (see CFStep above).
type ConsultantStep = "welcome" | "benefits" | "theme" | "expect";

function ConsultantWelcomeDeck({ firstName }: { firstName: string }) {
	const navigate = useNavigate();

	const steps = useMemo<ConsultantStep[]>(() => {
		const list: ConsultantStep[] = ["welcome", "benefits"];
		if (featureFlags.themeSystem) list.push("theme");
		list.push("expect");
		return list;
	}, []);
	const [index, setIndex] = useState(0);
	const [direction, setDirection] = useState<1 | -1>(1);
	const current = steps[index];
	const goNext = () => {
		if (index < steps.length - 1) {
			setDirection(1);
			setIndex(index + 1);
		}
	};
	const goBack = () => {
		if (index > 0) {
			setDirection(-1);
			setIndex(index - 1);
		}
	};

	const startApplication = () => {
		clearAuthContinuation();
		navigate({ to: "/consultant/apply" });
	};

	const [showCloseConfirm, setShowCloseConfirm] = useState(false);
	const handleClose = () => {
		if (index === 0) setShowCloseConfirm(true);
		else goBack();
	};

	return (
		<DeckShell
			stepper={
				<Stepper
					current={index + 1}
					total={steps.length}
					onClose={handleClose}
				/>
			}
			footer={
				<>
					Want to use Proyekto as a client first?{" "}
					<button
						type="button"
						onClick={() => navigateAfterWelcome(navigate)}
						className="font-semibold text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-slate-900 hover:decoration-slate-700"
					>
						Open my workspace →
					</button>
				</>
			}
		>
			<AnimatePresence mode="wait" initial={false} custom={direction}>
				{current === "welcome" && (
					<SlideOneConsultant
						key="c-1"
						firstName={firstName}
						onNext={goNext}
						direction={direction}
					/>
				)}
				{current === "benefits" && (
					<SlideTwoConsultant
						key="c-2"
						onBack={goBack}
						onNext={goNext}
						direction={direction}
					/>
				)}
				{current === "theme" && (
					<SlideTheme
						key="c-theme"
						onBack={goBack}
						onNext={goNext}
						direction={direction}
					/>
				)}
				{current === "expect" && (
					<SlideThreeConsultant
						key="c-3"
						onBack={goBack}
						onStart={startApplication}
						direction={direction}
					/>
				)}
			</AnimatePresence>

			{showCloseConfirm && (
				<CloseConfirmModal
					title="Apply later?"
					description="You can pick up the application anytime from your dashboard. Your workspace is ready in the meantime."
					confirmLabel="Open workspace"
					onCancel={() => setShowCloseConfirm(false)}
					onConfirm={() => navigateAfterWelcome(navigate)}
				/>
			)}
		</DeckShell>
	);
}

// ─── Shared deck shell (background, layout, footer) ────────────────────────

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
		<div className="min-h-screen bg-background text-foreground">
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

// ─── Stepper ────────────────────────────────────────────────────────────────

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

// ─── Slide motion variants ──────────────────────────────────────────────────

const slideVariants = {
	enter: (dir: 1 | -1) => ({ x: dir === 1 ? 24 : -24, opacity: 0 }),
	center: { x: 0, opacity: 1 },
	exit: (dir: 1 | -1) => ({ x: dir === 1 ? -24 : 24, opacity: 0 }),
};
const slideTransition = { duration: 0.25, ease: "easeOut" as const };

// ─── C/F Slide 1: Welcome ───────────────────────────────────────────────────

function SlideOneCF({
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

// ─── C/F Slide 2: Capabilities ──────────────────────────────────────────────

const cfCapabilities = [
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

function SlideTwoCF({
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
				Three things Proyekto does well — so you don't have to juggle five
				tools.
			</p>

			<div className="mx-auto mt-8 max-w-xl space-y-3">
				{cfCapabilities.map((cap) => {
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

// ─── C/F Slide 3: Workspace name ────────────────────────────────────────────

function SlideThreeCF({
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

// ─── C/F Slide 4: Invite ────────────────────────────────────────────────────

function SlideFourCF({
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
				Add the people you want collaborating on this workspace. You can skip
				and add them later.
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
							onChange={(e) =>
								updateInviteRow(row.id, { email: e.target.value })
							}
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

// ─── Consultant Slide 1: Welcome ────────────────────────────────────────────

function SlideOneConsultant({
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
			<div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 shadow-[0_8px_18px_rgba(245,158,11,0.12)]">
				<Crown className="h-6 w-6 text-amber-600" />
			</div>
			<h1 className="mt-6 text-balance text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
				Welcome to Proyekto, {firstName}.
			</h1>
			<p className="mx-auto mt-3 max-w-md text-balance text-sm text-slate-600 sm:text-base">
				Let's get you ready to apply.
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

// ─── Consultant Slide 2: What you're applying for ───────────────────────────

const consultantBenefits = [
	{
		icon: Sparkles,
		title: "Client workspace + AI planning",
		description:
			"Roadmap canvas, chat, files, time tracking. White-glove enough for your enterprise clients.",
	},
	{
		icon: Users,
		title: "Vetted talent bench",
		description:
			"Search and propose freelancers your clients can't see directly. Identity, portfolio, and rate verified by us.",
	},
	{
		icon: Wallet,
		title: "Escrow, contracts, invoicing",
		description:
			"Built-in commercial layer. Stop chasing wire transfers and reconciling spreadsheets.",
	},
];

function SlideTwoConsultant({
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
				What you're applying for
			</h1>
			<p className="mx-auto mt-3 max-w-lg text-center text-balance text-sm text-slate-600 sm:text-base">
				If approved, you'll get the operator's toolkit.
			</p>

			<div className="mx-auto mt-8 max-w-xl space-y-3">
				{consultantBenefits.map((b) => {
					const Icon = b.icon;
					return (
						<article
							key={b.title}
							className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_4px_12px_rgba(15,23,42,0.04)]"
						>
							<span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700">
								<Icon className="h-5 w-5" />
							</span>
							<div>
								<h3 className="text-base font-semibold text-slate-900">
									{b.title}
								</h3>
								<p className="mt-1 text-sm leading-relaxed text-slate-600">
									{b.description}
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

// ─── Consultant Slide 3: What to expect → Start application ─────────────────

const consultantExpectations = [
	{
		icon: Clock,
		title: "5-step application — about 15 minutes",
		description:
			"Identity, experience, profile sections, a short cover letter, and references.",
	},
	{
		icon: UserCheck,
		title: "Reviewed by a human within 5 business days",
		description:
			"Every application is read by our team. We'll email you with a decision.",
	},
	{
		icon: BookOpen,
		title: "Save and resume — no need to finish in one sitting",
		description:
			"Drafts auto-save. Come back from any device to pick up where you left off.",
	},
];

function SlideThreeConsultant({
	onBack,
	onStart,
	direction,
}: {
	onBack: () => void;
	onStart: () => void;
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
				What to expect
			</h1>
			<p className="mx-auto mt-3 max-w-lg text-center text-balance text-sm text-slate-600 sm:text-base">
				Quick application, fast decision.
			</p>

			<div className="mx-auto mt-8 max-w-xl space-y-3">
				{consultantExpectations.map((e) => {
					const Icon = e.icon;
					return (
						<article
							key={e.title}
							className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_4px_12px_rgba(15,23,42,0.04)]"
						>
							<span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700">
								<Icon className="h-5 w-5" />
							</span>
							<div>
								<h3 className="text-base font-semibold text-slate-900">
									{e.title}
								</h3>
								<p className="mt-1 text-sm leading-relaxed text-slate-600">
									{e.description}
								</p>
							</div>
						</article>
					);
				})}
			</div>

			<NavRow onBack={onBack} onNext={onStart} nextLabel="Start application" />
		</motion.div>
	);
}

// ─── Theme picker slide ─────────────────────────────────────────────────────

// Presets shown during onboarding — the four built-ins (Custom is excluded; it
// lives in Settings → Appearance). Ordering + labels come from THEME_OPTIONS,
// colors from PRESET_THEMES.
const WELCOME_THEME_PRESETS = THEME_OPTIONS.filter(
	(option): option is { id: Exclude<ThemeId, "custom">; label: string } =>
		option.id !== "custom",
);

function SlideTheme({
	onBack,
	onNext,
	direction,
}: {
	onBack: () => void;
	onNext: () => void;
	direction: 1 | -1;
}) {
	const theme = useAppearanceStore((s) => s.preferences.theme);
	const setTheme = useAppearanceStore((s) => s.setTheme);

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
				Make it yours
			</h1>
			<p className="mx-auto mt-3 max-w-lg text-center text-balance text-sm text-slate-600 sm:text-base">
				Pick a look for your workspace — you can change it anytime.
			</p>

			<div className="mx-auto mt-8 grid max-w-xl grid-cols-2 gap-3 sm:gap-4">
				{WELCOME_THEME_PRESETS.map((option) => {
					const t = PRESET_THEMES[option.id].tokens;
					const selected = theme === option.id;
					return (
						<button
							key={option.id}
							type="button"
							onClick={() => setTheme(option.id)}
							aria-pressed={selected}
							aria-label={`Use ${option.label} theme`}
							style={{
								background: t.background,
								borderColor: selected ? t.primary : t.border,
								boxShadow: selected ? `0 0 0 2px ${t.primary}` : undefined,
							}}
							className="rounded-2xl border p-3 text-left transition-all hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
						>
							{/* Mini window mock, painted in the preset's own colors. */}
							<div
								style={{ background: t.card, borderColor: t.border }}
								className="rounded-xl border p-3"
							>
								<div className="flex items-center gap-2">
									<span
										style={{ background: t.primary, color: t.primaryForeground }}
										className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold"
									>
										Aa
									</span>
									<span className="flex flex-1 flex-col gap-1.5">
										<span
											style={{ background: t.foreground, opacity: 0.85 }}
											className="h-1.5 w-3/4 rounded-full"
										/>
										<span
											style={{ background: t.mutedForeground }}
											className="h-1.5 w-1/2 rounded-full"
										/>
									</span>
								</div>
								<div className="mt-3 space-y-1.5">
									<span
										style={{ background: t.mutedForeground, opacity: 0.45 }}
										className="block h-1.5 w-full rounded-full"
									/>
									<span
										style={{ background: t.mutedForeground, opacity: 0.45 }}
										className="block h-1.5 w-5/6 rounded-full"
									/>
								</div>
							</div>

							<div className="mt-3 flex items-center justify-between px-0.5">
								<span
									style={{ color: t.foreground }}
									className="text-sm font-semibold"
								>
									{option.label}
								</span>
								{selected && (
									<span
										style={{ background: t.primary, color: t.primaryForeground }}
										className="inline-flex h-5 w-5 items-center justify-center rounded-full"
									>
										<Check className="h-3 w-3" />
									</span>
								)}
							</div>
						</button>
					);
				})}
			</div>

			<p className="mx-auto mt-5 max-w-lg text-center text-xs text-slate-500">
				You can fine-tune colors later in Settings → Appearance.
			</p>

			<NavRow onBack={onBack} onNext={onNext} nextLabel="Next" />
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
		<ModalPortal>
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
		</ModalPortal>
	);
}
