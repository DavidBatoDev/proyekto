import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useReducer, useState } from "react";
import { ModalPortal } from "@/components/common/ModalPortal";
import { GoLivePanel } from "@/components/marketplace/talent/go-live/GoLiveForm";
import { GoLiveNav } from "@/components/marketplace/talent/go-live/GoLiveNav";
import {
	draftReducer,
	emptyDraft,
	type ProfileDraft,
} from "@/components/marketplace/talent/go-live/profileDraft";
import { StepGetStarted } from "@/components/marketplace/talent/go-live/steps/StepGetStarted";
import { StepProfile } from "@/components/marketplace/talent/go-live/steps/StepProfile";
import { StepReview } from "@/components/marketplace/talent/go-live/steps/StepReview";
import { StepWorkAndRate } from "@/components/marketplace/talent/go-live/steps/StepWorkAndRate";
import { useToast } from "@/hooks/useToast";
import { profileService } from "@/services/profile.service";
import { profileImportService } from "@/services/profileImport.service";
import { uploadService } from "@/services/upload.service";
import { useAuthStore } from "@/stores/authStore";

export const Route = createFileRoute("/marketplace/talent/go-live")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) throw redirect({ to: "/auth/login" });
	},
	component: TalentGoLivePage,
});

const profileKeys = { full: (id: string) => ["full-profile", id] as const };

/** Step count only — the labelled rail was replaced by the bottom progress bar. */
const TOTAL_STEPS = 4;

const STEP_COPY = [
	{
		title: "Let's build your profile",
		body: "Import everything from a LinkedIn export or a CV, or start from scratch. Either way you get to check it before anything is saved.",
	},
	{
		title: "Who you are and what you do",
		body: "This is what clients see and what search matches on. A clear headline does more for you here than anything else on the page.",
	},
	{
		title: "Your work and your rate",
		body: "Show something a client can look at, and set what you charge. Both are needed before your listing can go live.",
	},
	{
		title: "Check it over",
		body: "Everything you have entered, plus what the marketplace still needs before your profile can be published.",
	},
];

/**
 * The Go live wizard.
 *
 * Rewritten from six steps to five, and -- more to the point -- it now collects
 * the profile. The previous version asked for a rate, a specialization, skills,
 * a portfolio and an ID, but never for a headline, bio or country, all three of
 * which the server requires before it will publish anyone. People could
 * complete every step and be refused at the last one for data the form had
 * never asked them for.
 *
 * State lives in one draft object (see profileDraft.ts). Each step commits its
 * own slice on the way out rather than everything landing at the end, so the
 * eligibility checklist on step 5 can ask the server a question whose answer is
 * actually true.
 *
 * Sections live in components/marketplace/talent/go-live/ rather than
 * inline: the version this replaces was 1,053 lines in a single route file.
 */
function TalentGoLivePage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { user } = useAuthStore();
	const toast = useToast();

	const [currentStep, setCurrentStep] = useState(1);
	const [draft, dispatch] = useReducer(draftReducer, emptyDraft);
	const [hydrated, setHydrated] = useState(false);
	const [showSuccess, setShowSuccess] = useState(false);

	const profileQuery = useQuery({
		queryKey: profileKeys.full(user?.id ?? ""),
		queryFn: () => profileService.getProfile(user!.id),
		enabled: !!user?.id,
	});
	const profile = profileQuery.data;

	useEffect(() => {
		if (!profile || hydrated) return;
		// Anything already on the profile seeds the draft, so somebody re-running
		// the wizard edits their own data instead of blanking it.
		dispatch({
			type: "hydrate",
			profile,
			portfolios: profile.portfolios ?? [],
		});
		setHydrated(true);
	}, [profile, hydrated]);

	/** Step 2 lands through the one transactional import RPC. */
	const saveProfileMutation = useMutation({
		mutationFn: async (state: ProfileDraft) => {
			// The avatar is held as a local blob until now so the preview is
			// instant and an abandoned wizard never orphans an object in R2.
			// uploadAvatar persists the url itself, so it is not part of the RPC
			// payload below.
			if (state.avatarFile) {
				await uploadService.uploadAvatar(state.avatarFile);
			}
			return profileImportService.apply({
				source: state.source,
				basics: {
					display_name: state.display_name || undefined,
					headline: state.headline || undefined,
					bio: state.bio || undefined,
					country: state.country || undefined,
					city: state.city || undefined,
				},
				skills: state.skills,
				languages: state.languages,
				experiences: state.experiences,
				educations: state.educations,
				certifications: state.certifications,
				specialization: {
					category: state.specCategory,
					sub_category: state.specSubcategory || undefined,
					years_of_experience: state.specYears
						? Number(state.specYears)
						: undefined,
				},
			});
		},
	});

	const saveWorkMutation = useMutation({
		mutationFn: async (state: ProfileDraft) => {
			await profileService.updateRateSettings({
				availability: state.availability,
				hourly_rate: Number.parseFloat(state.hourlyRate) || 0,
				currency: state.currency,
				weekly_hours: Number.parseInt(state.weeklyHours, 10) || 0,
			});

			// Links become portfolio rows. `title` is NOT NULL and `url` is
			// @IsUrl()-validated, so the hostname stands in as a title rather than
			// an empty string the user never chose.
			const existing = new Set(
				(profile?.portfolios ?? []).map((item) => item.url).filter(Boolean),
			);
			const additions = state.links.filter((link) => !existing.has(link));
			for (const [index, url] of additions.entries()) {
				await profileService.addPortfolio({
					title: safeHostname(url),
					description: null,
					url,
					image_url: null,
					tags: [],
					position: (profile?.portfolios?.length ?? 0) + index,
				});
			}
		},
	});

	const goLiveMutation = useMutation({
		mutationFn: () => profileService.goLive(),
		onSuccess: () => {
			setShowSuccess(true);
			void queryClient.invalidateQueries({
				queryKey: profileKeys.full(user?.id ?? ""),
			});
		},
	});

	/**
	 * Where "you're live" should land: the profile they just built, which is the
	 * page a client will see. The dashboard says nothing about the listing.
	 */
	const goToProfile = () =>
		navigate({
			to: "/profile/$profileId",
			params: { profileId: user?.id ?? "" },
		});

	const isSaving =
		saveProfileMutation.isPending ||
		saveWorkMutation.isPending ||
		goLiveMutation.isPending;

	const refreshProfile = () =>
		queryClient.invalidateQueries({
			queryKey: profileKeys.full(user?.id ?? ""),
		});

	const advance = async () => {
		try {
			if (currentStep === 1) {
				if (!draft.path) {
					toast.error("Pick how you would like to start.");
					return;
				}
			} else if (currentStep === 2) {
				if (
					!draft.headline.trim() ||
					!draft.bio.trim() ||
					!draft.country.trim()
				) {
					toast.error(
						"A headline, a short bio and your country are all needed before you can go live.",
					);
					return;
				}
				await saveProfileMutation.mutateAsync(draft);
				if (draft.avatarFile) {
					dispatch({ type: "set", patch: { avatarFile: null } });
				}
				await refreshProfile();
			} else if (currentStep === 3) {
				if (!draft.links.length) {
					toast.error("Add at least one link to your work.");
					return;
				}
				if (!Number.parseFloat(draft.hourlyRate)) {
					toast.error("Set your hourly rate.");
					return;
				}
				await saveWorkMutation.mutateAsync(draft);
				await refreshProfile();
			} else {
				await goLiveMutation.mutateAsync();
				return;
			}
			setCurrentStep((step) => Math.min(step + 1, TOTAL_STEPS));
		} catch (cause) {
			toast.error(readError(cause));
		}
	};

	if (profileQuery.isLoading) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background pt-app-header">
				<Loader2 className="h-8 w-8 animate-spin text-primary" />
			</div>
		);
	}

	if (!profile) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background px-4 pt-app-header">
				<GoLivePanel className="p-8 text-center">
					<h2 className="text-lg font-semibold text-foreground">
						Profile unavailable
					</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						We could not load your profile just now.
					</p>
				</GoLivePanel>
			</div>
		);
	}

	const copy = STEP_COPY[currentStep - 1];

	return (
		<div className="min-h-screen bg-background pt-app-header text-foreground">
			<div className="mx-auto max-w-6xl px-4 pb-32 pt-8 sm:px-6 lg:px-8 lg:pt-12">
				<div className="grid gap-8 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-12">
					<div className="relative">
						<div className="lg:sticky lg:top-[120px]">
							<AnimatePresence mode="wait">
								<motion.div
									key={currentStep}
									initial={{ opacity: 0, x: -20 }}
									animate={{ opacity: 1, x: 0 }}
									exit={{ opacity: 0, x: -20 }}
									transition={{ duration: 0.35, ease: "easeOut" }}
								>
									<h1 className="mb-3 text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl lg:text-4xl">
										{copy.title}
									</h1>
									<p className="text-[15px] leading-relaxed text-muted-foreground lg:text-lg">
										{copy.body}
									</p>
								</motion.div>
							</AnimatePresence>
						</div>
					</div>

					<div className="min-h-[500px]">
						{/*
						 * Keyed on the step so each panel mounts and unmounts as its own
						 * element -- without the key, React reuses the subtree and the
						 * content swaps with no transition at all.
						 *
						 * `mode="wait"` matters here: the panels are tall and their
						 * heights differ a lot, so overlapping the exit and entry would
						 * make the page jump while the bottom bar stays put.
						 */}
						<AnimatePresence mode="wait">
							<motion.div
								key={currentStep}
								initial={{ opacity: 0, x: 24 }}
								animate={{ opacity: 1, x: 0 }}
								exit={{ opacity: 0, x: -24 }}
								transition={{ duration: 0.28, ease: "easeOut" }}
							>
								{currentStep === 1 && (
									<StepGetStarted
										path={draft.path}
										onChoosePath={(path) =>
											dispatch({ type: "set", patch: { path } })
										}
										onImported={(imported) => {
											dispatch({ type: "applyImport", imported });
											setCurrentStep(2);
										}}
									/>
								)}
								{currentStep === 2 && (
									<StepProfile draft={draft} dispatch={dispatch} />
								)}
								{currentStep === 3 && (
									<StepWorkAndRate draft={draft} dispatch={dispatch} />
								)}
								{currentStep === 4 && (
									<StepReview draft={draft} enabled={currentStep === 4} />
								)}
							</motion.div>
						</AnimatePresence>

						<GoLiveNav
							currentStep={currentStep}
							totalSteps={TOTAL_STEPS}
							isSaving={isSaving}
							onBack={() => setCurrentStep((step) => Math.max(step - 1, 1))}
							onNext={() => void advance()}
						/>
					</div>
				</div>
			</div>

			<ModalPortal>
				<AnimatePresence>
					{showSuccess && (
						<motion.div
							className="fixed inset-0 z-9999 flex items-center justify-center p-4"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
						>
							<motion.div
								className="absolute inset-0 bg-black/50 backdrop-blur-sm"
								onClick={() => goToProfile()}
							/>
							<motion.div
								className="relative w-full max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-2xl"
								initial={{ opacity: 0, scale: 0.9, y: 20 }}
								animate={{ opacity: 1, scale: 1, y: 0 }}
								exit={{ opacity: 0, scale: 0.9, y: 20 }}
							>
								<div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
									<CheckCircle2 className="h-8 w-8 text-primary" />
								</div>
								<h2 className="mb-2 text-3xl font-semibold tracking-tight text-foreground">
									You're live
								</h2>
								<p className="mb-8 text-sm text-muted-foreground">
									Consultants can now find you and match you with work based on
									your skills and availability.
								</p>
								<button
									type="button"
									onClick={() => goToProfile()}
									className="w-full cursor-pointer rounded-lg bg-primary px-8 py-3 font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
								>
									View your profile
								</button>
							</motion.div>
						</motion.div>
					)}
				</AnimatePresence>
			</ModalPortal>
		</div>
	);
}

function safeHostname(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

/**
 * The go-live endpoint answers with a `missing` array of raw enum values, which
 * the old wizard pasted at the user verbatim ("...: identity, profile_basics").
 * Step 5's checklist explains those properly, so point people at it instead.
 */
function readError(cause: unknown): string {
	const response = (
		cause as {
			response?: {
				data?: { message?: string | string[]; missing?: string[] };
			};
		}
	)?.response?.data;

	if (response?.missing?.length) {
		return "Some things are still missing - see the checklist above.";
	}
	// Nest's ValidationPipe answers with an ARRAY of messages, one per failed
	// field. Returning it unread showed axios's generic "Request failed with
	// status code 400" and hid the one thing that says what was wrong.
	if (Array.isArray(response?.message)) {
		return response.message.slice(0, 3).join(". ");
	}
	if (response?.message) return response.message;
	if (cause instanceof Error) return cause.message;
	return "Something went wrong. Please try again.";
}
