import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
	ArrowLeft,
	ArrowRight,
	Check,
	CheckCircle2,
	Plus,
	Sparkles,
	Trash2,
	Users,
	Workflow,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "@/api";
import { ModalPortal } from "@/components/common/ModalPortal";
import { normalizeTags } from "@/components/common/TagInput";
import {
	EMPTY_TEAM_DRAFT,
	type TeamDraft,
	TeamFormFields,
} from "@/components/team/TeamFormFields";
import { featureFlags } from "@/config/featureFlags";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { useToast } from "@/hooks/useToast";
import { completeOnboarding } from "@/lib/auth-api";
import { clearAuthContinuation } from "@/lib/authContinuation";
import { getPendingProjectFromRoadmap } from "@/lib/guestRoadmapConversion";
import { supabase } from "@/lib/supabase";
import { createTeam, listMyTeams, updateTeam } from "@/services/teams.service";
import { useAppearanceStore } from "@/stores/appearanceStore";
import { useAuthStore } from "@/stores/authStore";
import { PRESET_THEMES, THEME_OPTIONS } from "@/theme/presets";
import type { ThemeId } from "@/theme/types";
import { Button } from "@/ui/button";

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
	useProfileQuery(); // ensures profile is fetched and synced to the store on fresh loads
	const storedProfile = useAuthStore((s) => s.profile);
	const [completedProfile, setCompletedProfile] =
		useState<typeof storedProfile>(null);
	const profile = completedProfile ?? storedProfile;
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
		void completeOnboarding()
			.then((result) => {
				setCompletedProfile(result.profile);
				useAuthStore.setState({ profile: result.profile });
			})
			.catch((err) => {
				ensuredCompletionRef.current = false;
				console.error(
					"Welcome-deck onboarding completion backstop failed:",
					err,
				);
			});
	}, [profile]);

	// Wait for profile hydration before rendering. Guessing here causes a
	// flicker when the user lands on /welcome immediately after signup
	// (profile arrives async via onAuthStateChange).
	if (!profile) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background text-foreground">
				<div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" />
			</div>
		);
	}

	const firstName =
		(profile.first_name as string | undefined) ||
		profile.display_name ||
		"there";

	return <ClientFreelancerWelcomeDeck firstName={firstName} />;
}

// ─── Client/Freelancer deck ─────────────────────────────────────────────────

// Ordered step keys. The "theme" step is inserted only when the theme system is
// enabled, so navigation and the stepper total are driven off this array rather
// than a fixed number.
type CFStep =
	| "welcome"
	| "capabilities"
	| "workspace"
	| "theme"
	| "team"
	| "invite";

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

// Exported for tests: the route still renders WelcomePage, but the deck is
// where the step logic lives and mounting it directly skips profile hydration.
export function ClientFreelancerWelcomeDeck({
	firstName,
}: {
	firstName: string;
}) {
	const navigate = useNavigate();
	const toast = useToast();
	const user = useAuthStore((s) => s.user);
	const queryClient = useQueryClient();

	// ── Workspace lookup ─────────────────────────────────────────────────────
	const [workspaceId, setWorkspaceId] = useState<string | null>(null);
	const [workspaceTitle, setWorkspaceTitle] = useState<string>("");
	const [workspaceLoadFailed, setWorkspaceLoadFailed] = useState(false);

	useEffect(() => {
		if (!user?.id) return;
		let cancelled = false;
		(async () => {
			const { data, error } = await supabase
				.from("personal_workspaces")
				.select("project:projects(id, title)")
				.eq("user_id", user.id)
				.maybeSingle();
			if (cancelled) return;
			const project = data?.project as
				| { id: string; title: string | null }
				| null
				| undefined;
			if (error || !project) {
				setWorkspaceLoadFailed(true);
				return;
			}
			setWorkspaceId(project.id);
			setWorkspaceTitle(project.title ?? "");
		})();
		return () => {
			cancelled = true;
		};
	}, [user?.id]);

	// ── Slide state (ordered; theme step is flag-gated) ──────────────────────
	const steps = useMemo<CFStep[]>(() => {
		const list: CFStep[] = ["welcome", "capabilities", "workspace"];
		if (featureFlags.themeSystem) list.push("theme");
		list.push("team");
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

	// ── Team step ────────────────────────────────────────────────────────────
	const [teamDraft, setTeamDraft] = useState<TeamDraft>(EMPTY_TEAM_DRAFT);
	const [teamId, setTeamId] = useState<string | null>(null);
	const [existingTeamName, setExistingTeamName] = useState<string | null>(null);
	const [teamLookupFailed, setTeamLookupFailed] = useState(false);
	const [savingTeam, setSavingTeam] = useState(false);
	const [teamFailureCount, setTeamFailureCount] = useState(0);
	const lastSavedTeamRef = useRef<TeamDraft | null>(null);

	// Re-entry: /welcome is revisitable (the completeOnboarding backstop above,
	// legacy accounts, a failed OAuth callback). Without this, every revisit
	// would make another team. Look up teams this user already OWNS and prefill.
	//
	// `is_personal` teams are excluded deliberately: a consultant vetted before
	// revisiting has one, and prefilling from it would let the deck rename the
	// team that vetting provisioned.
	useEffect(() => {
		if (!user?.id) return;
		let cancelled = false;
		(async () => {
			try {
				const teams = await listMyTeams();
				if (cancelled) return;
				const existing = teams
					.filter((t) => t.owner_id === user.id && !t.is_personal)
					.sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
				if (!existing) return;
				const draft: TeamDraft = {
					name: existing.name,
					description: existing.description ?? "",
					tags: existing.tags ?? [],
				};
				setTeamId(existing.id);
				setExistingTeamName(existing.name);
				setTeamDraft(draft);
				lastSavedTeamRef.current = draft;
			} catch (err) {
				if (cancelled) return;
				console.error("Welcome-deck team lookup failed:", err);
				// Enables the skip escape hatch — a lookup we can't do must not
				// leave the user stuck behind a required step.
				setTeamLookupFailed(true);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [user?.id]);

	const persistTeam = async () => {
		const name = teamDraft.name.trim();
		if (!name) {
			toast.error("Give your team a name");
			throw new Error("empty team name");
		}
		const description = teamDraft.description.trim();
		const tags = normalizeTags(teamDraft.tags);
		const saved = lastSavedTeamRef.current;
		const unchanged =
			saved !== null &&
			saved.name === name &&
			saved.description === description &&
			saved.tags.length === tags.length &&
			saved.tags.every((t, i) => t === tags[i]);
		if (unchanged) return;

		setSavingTeam(true);
		try {
			if (teamId) {
				// Re-entry, or already created earlier in this session: PATCH.
				// Never a second POST.
				const updated = await updateTeam(teamId, { name, description, tags });
				setExistingTeamName(updated.name);
			} else {
				const created = await createTeam({
					name,
					description: description || undefined,
					tags,
				});
				// Storing the id is the in-session duplicate guard: a later edit
				// on this slide updates instead of creating a second team.
				setTeamId(created.id);
				setExistingTeamName(created.name);
			}
			lastSavedTeamRef.current = { name, description, tags };
			setTeamFailureCount(0);
			void queryClient.invalidateQueries({ queryKey: ["teams"] });
		} catch (err) {
			console.error("Welcome-deck team save failed:", err);
			setTeamFailureCount((n) => n + 1);
			toast.error(
				(err as Error).message || "Couldn't save your team. Try again.",
			);
			throw err;
		} finally {
			setSavingTeam(false);
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
	// Always offer the exit. This used to act as Back on slides 2+, which was
	// already redundant with NavRow's Back — and with a required team step it
	// would leave the X as the only visible way out while not actually being one.
	const handleClose = () => setShowCloseConfirm(true);

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
						href="/marketplace/consultant"
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
				{current === "team" && (
					<SlideTeamCF
						key="cf-team"
						draft={teamDraft}
						setDraft={setTeamDraft}
						existingTeamName={existingTeamName}
						submitting={savingTeam}
						// Two failed saves, or a lookup we couldn't do at all, means
						// something is wrong on our side — don't hold the user hostage
						// to a required step we can't complete.
						allowSkip={teamLookupFailed || teamFailureCount >= 2}
						onSkip={goNext}
						onBack={goBack}
						onNext={async () => {
							try {
								await persistTeam();
								goNext();
							} catch {
								/* toast already shown */
							}
						}}
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

/**
 * Required step: every user leaves onboarding owning a team.
 *
 * The team created here is deliberately NOT the personal team — that one is
 * still provisioned only at consultant vetting approval, and nothing on this
 * slide writes `is_personal`.
 */
function SlideTeamCF({
	draft,
	setDraft,
	existingTeamName,
	submitting,
	allowSkip,
	onSkip,
	onBack,
	onNext,
	direction,
}: {
	draft: TeamDraft;
	setDraft: (next: TeamDraft) => void;
	existingTeamName: string | null;
	submitting: boolean;
	allowSkip: boolean;
	onSkip: () => void;
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
				Create your team
			</h1>
			<p className="mx-auto mt-3 max-w-lg text-center text-balance text-sm text-slate-600 sm:text-base">
				A team is a reusable group of people you attach to projects. You'll be
				its owner — the name and everything else can change later.
			</p>

			{existingTeamName && (
				<p className="mx-auto mt-4 max-w-md rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-sm text-slate-600">
					You already have <strong>{existingTeamName}</strong> — we've filled it
					in. Continuing keeps it and saves any edits.
				</p>
			)}

			<div className="mx-auto mt-8 max-w-md">
				<TeamFormFields
					draft={draft}
					onChange={setDraft}
					disabled={submitting}
					autoFocus
					variant="deck"
				/>
			</div>

			<NavRow
				onBack={onBack}
				onNext={onNext}
				nextLabel={submitting ? "Saving…" : "Next"}
				nextDisabled={submitting || !draft.name.trim()}
				extraAction={
					allowSkip ? (
						<button
							type="button"
							onClick={onSkip}
							className="text-sm font-semibold text-slate-500 transition-colors hover:text-slate-900"
						>
							Skip for now
						</button>
					) : undefined
				}
			/>
		</motion.div>
	);
}

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
				Invite people to your workspace
			</h1>
			{/* Deliberately workspace invites, not team invites: only a
			    project_access row lets someone actually open anything, and team
			    membership alone grants none until the team is attached to a
			    project and its members curated in. */}
			<p className="mx-auto mt-3 max-w-lg text-center text-balance text-sm text-slate-600 sm:text-base">
				These people get access to your workspace. Managing your team's roster
				happens later, in Team settings. You can skip and add them anytime.
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
										style={{
											background: t.primary,
											color: t.primaryForeground,
										}}
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
										style={{
											background: t.primary,
											color: t.primaryForeground,
										}}
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
	nextDisabled,
	extraAction,
}: {
	onBack: () => void;
	onNext: () => void;
	nextLabel: string;
	nextDisabled?: boolean;
	/** Optional third control between Back and Next (the team step's skip). */
	extraAction?: React.ReactNode;
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
			{extraAction}
			<Button
				variant="contained"
				colorScheme="primary"
				onClick={onNext}
				disabled={nextDisabled}
				className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.26)] hover:bg-slate-800 disabled:opacity-60"
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
