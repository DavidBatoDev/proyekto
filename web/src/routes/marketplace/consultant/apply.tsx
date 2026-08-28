import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Clock, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useReducer, useState } from "react";
import { ModalPortal } from "@/components/common/ModalPortal";
import {
	applyReducer,
	type ConsultantApplyDraft,
	emptyApplyDraft,
} from "@/components/marketplace/consultant/apply/applicationDraft";
import { StepApplicationReview } from "@/components/marketplace/consultant/apply/steps/StepApplicationReview";
import { StepConsultantDetails } from "@/components/marketplace/consultant/apply/steps/StepConsultantDetails";
import { StepIdentity } from "@/components/marketplace/consultant/apply/steps/StepIdentity";
import {
	GoLiveCallout,
	GoLivePanel,
} from "@/components/marketplace/wizard/GoLiveForm";
import { GoLiveNav } from "@/components/marketplace/wizard/GoLiveNav";
import {
	readError,
	safeHostname,
} from "@/components/marketplace/wizard/helpers";
import { StepGetStarted } from "@/components/marketplace/wizard/steps/StepGetStarted";
import { StepProfile } from "@/components/marketplace/wizard/steps/StepProfile";
import { useToast } from "@/hooks/useToast";
import { applicationService, profileService } from "@/services/profile.service";
import { profileImportService } from "@/services/profileImport.service";
import { uploadService } from "@/services/upload.service";
import { useAuthStore } from "@/stores/authStore";

export const Route = createFileRoute("/marketplace/consultant/apply")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) throw redirect({ to: "/auth/login" });
	},
	component: ConsultantApplyPage,
});

const profileKeys = { full: (id: string) => ["full-profile", id] as const };
const applicationKey = ["consultant-application", "me"] as const;

const TOTAL_STEPS = 5;

const STEP_COPY = [
	{
		title: "Apply to lead on Proyekto",
		body: "Import everything from a LinkedIn export or a CV, or start from scratch. Either way you get to check it before anything is saved.",
	},
	{
		title: "Who you are and what you do",
		body: "This is what the review team reads first and what clients see once you are verified. A clear headline does more for you here than anything else on the page.",
	},
	{
		title: "Your expertise and your rate",
		body: "Where you belong in the marketplace, links a reviewer can actually open, and what you charge. Approval places you in the directory with all of it.",
	},
	{
		title: "Verify your identity",
		body: "One government-issued photo ID, stored privately. Verified identity is what makes a Proyekto consultant a vetted lead rather than a listing.",
	},
	{
		title: "Check it over",
		body: "Everything you have entered, plus what the review team still needs before you can submit.",
	},
];

/**
 * The consultant application wizard.
 *
 * Rebuilt on the talent go-live pattern: one reducer draft, each step commits
 * its own slice on the way out, and the review step asks the server a
 * question whose answer is actually true. Steps 1 and 2 are literally the
 * shared wizard components; step 3 stages taxonomy placements on the
 * application, step 4 makes the identity document a real requirement, and
 * step 5 submits for admin review.
 *
 * Status gates precede the wizard: a submitted application shows its state,
 * an approved one points at the consultant surfaces, and a rejected one
 * reopens the wizard with the reviewer's reason — revise and resubmit.
 */
function ConsultantApplyPage() {
	const queryClient = useQueryClient();
	const { user } = useAuthStore();
	const toast = useToast();

	const [currentStep, setCurrentStep] = useState(1);
	const [draft, dispatch] = useReducer(applyReducer, emptyApplyDraft);
	const [hydratedProfile, setHydratedProfile] = useState(false);
	const [hydratedApplication, setHydratedApplication] = useState(false);
	const [showSuccess, setShowSuccess] = useState(false);

	const profileQuery = useQuery({
		queryKey: profileKeys.full(user?.id ?? ""),
		queryFn: () => profileService.getProfile(user!.id),
		enabled: !!user?.id,
	});
	const profile = profileQuery.data;

	const applicationQuery = useQuery({
		queryKey: applicationKey,
		queryFn: () => applicationService.getMyApplication(),
		enabled: !!user?.id,
	});
	const application = applicationQuery.data;

	useEffect(() => {
		if (!profile || hydratedProfile) return;
		dispatch({
			type: "hydrate",
			profile,
			portfolios: profile.portfolios ?? [],
		});
		setHydratedProfile(true);
	}, [profile, hydratedProfile]);

	useEffect(() => {
		if (applicationQuery.isLoading || hydratedApplication) return;
		if (application) {
			dispatch({ type: "hydrateApplication", application });
		}
		setHydratedApplication(true);
	}, [application, applicationQuery.isLoading, hydratedApplication]);

	/** Step 2 lands through the one transactional import RPC. */
	const saveProfileMutation = useMutation({
		mutationFn: async (state: ConsultantApplyDraft) => {
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
			});
		},
	});

	/** Step 3: application draft + rate card + portfolio rows. */
	const saveDetailsMutation = useMutation({
		mutationFn: async (state: ConsultantApplyDraft) => {
			await applicationService.saveDraft({
				linkedin_url: state.linkedinUrl,
				placements: state.placements.map((placement) => ({
					subcategory_id: placement.subcategoryId,
					years_experience: placement.yearsExperience ?? undefined,
				})),
				primary_subcategory_id: state.primarySubcategoryId ?? undefined,
			});

			await profileService.updateRateSettings({
				availability: state.availability,
				hourly_rate: Number.parseFloat(state.hourlyRate) || 0,
				currency: state.currency,
				weekly_hours: Number.parseInt(state.weeklyHours, 10) || 0,
			});

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

	const submitMutation = useMutation({
		mutationFn: () => applicationService.submit(),
		onSuccess: () => {
			setShowSuccess(true);
			void queryClient.invalidateQueries({ queryKey: applicationKey });
		},
	});

	const isSaving =
		saveProfileMutation.isPending ||
		saveDetailsMutation.isPending ||
		submitMutation.isPending;

	const refresh = () =>
		Promise.all([
			queryClient.invalidateQueries({
				queryKey: profileKeys.full(user?.id ?? ""),
			}),
			queryClient.invalidateQueries({ queryKey: applicationKey }),
		]);

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
						"A headline, a short bio and your country are all needed before you can submit.",
					);
					return;
				}
				await saveProfileMutation.mutateAsync(draft);
				if (draft.avatarFile) {
					dispatch({ type: "set", patch: { avatarFile: null } });
				}
				await refresh();
			} else if (currentStep === 3) {
				if (!draft.placements.length) {
					toast.error("Pick at least one speciality.");
					return;
				}
				if (draft.placements.some((p) => p.yearsExperience === null)) {
					toast.error("Set your years of experience for each speciality.");
					return;
				}
				if (!draft.linkedinUrl.trim()) {
					toast.error("Add your LinkedIn profile.");
					return;
				}
				if (!draft.links.length) {
					toast.error("Add at least one link to your work.");
					return;
				}
				if (!Number.parseFloat(draft.hourlyRate)) {
					toast.error("Set your hourly rate.");
					return;
				}
				// @IsUrl on the API rejects a bare domain; normalise like the
				// links list does rather than failing the save.
				if (!/^https?:\/\//i.test(draft.linkedinUrl.trim())) {
					dispatch({
						type: "setApply",
						patch: { linkedinUrl: `https://${draft.linkedinUrl.trim()}` },
					});
				}
				await saveDetailsMutation.mutateAsync({
					...draft,
					linkedinUrl: /^https?:\/\//i.test(draft.linkedinUrl.trim())
						? draft.linkedinUrl.trim()
						: `https://${draft.linkedinUrl.trim()}`,
				});
				await refresh();
			} else if (currentStep === 4) {
				if (!(profile?.identity_documents ?? []).length) {
					toast.error("Upload an identity document to continue.");
					return;
				}
			} else {
				await submitMutation.mutateAsync();
				return;
			}
			setCurrentStep((step) => Math.min(step + 1, TOTAL_STEPS));
		} catch (cause) {
			toast.error(readError(cause));
		}
	};

	if (profileQuery.isLoading || applicationQuery.isLoading) {
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

	// Status gates. `rejected` deliberately falls through to the wizard —
	// revise and resubmit is the contract, with the reviewer's reason shown.
	if (
		!showSuccess &&
		(application?.status === "submitted" ||
			application?.status === "under_review")
	) {
		return (
			<StatusCard
				icon={<Clock className="h-8 w-8 text-primary" />}
				title="Your application is in review"
				body="The review team has it. You will be notified here the moment there is a decision — there is nothing more you need to do."
			/>
		);
	}
	// consultant_status covers consultants verified without an application row
	// (seeded or legacy enrollments) — they get the same "you're in" card.
	if (
		application?.status === "approved" ||
		profile.consultant_status === "verified"
	) {
		return (
			<StatusCard
				icon={<ShieldCheck className="h-8 w-8 text-primary" />}
				title="You're a verified consultant"
				body="You're verified to lead on Proyekto. The consultant surfaces — the talent pool, project briefs, templates and your service catalog — are open to you."
				action={
					<Link
						to="/marketplace"
						className="inline-block w-full cursor-pointer rounded-lg bg-primary px-8 py-3 font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
					>
						Go to the marketplace
					</Link>
				}
			/>
		);
	}

	const copy = STEP_COPY[currentStep - 1];
	const isResubmission = application?.status === "rejected";

	return (
		<div className="min-h-screen bg-background pt-app-header text-foreground">
			<div className="mx-auto max-w-6xl px-4 pb-32 pt-8 sm:px-6 lg:px-8 lg:pt-12">
				{isResubmission && (
					<div className="mb-8">
						<GoLiveCallout tone="caution">
							<p className="font-medium text-foreground">
								Your previous application was not approved.
							</p>
							<p className="mt-0.5 text-muted-foreground">
								{application?.rejection_reason
									? `The review team's note: ${application.rejection_reason}`
									: "Revise your application below and submit it again."}
							</p>
						</GoLiveCallout>
					</div>
				)}

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
									<StepConsultantDetails draft={draft} dispatch={dispatch} />
								)}
								{currentStep === 4 && (
									<StepIdentity
										documents={profile.identity_documents ?? []}
										profileKey={profileKeys.full(user?.id ?? "")}
									/>
								)}
								{currentStep === 5 && (
									<StepApplicationReview
										draft={draft}
										enabled={currentStep === 5}
										isResubmission={isResubmission}
									/>
								)}
							</motion.div>
						</AnimatePresence>

						<GoLiveNav
							currentStep={currentStep}
							totalSteps={TOTAL_STEPS}
							isSaving={isSaving}
							onBack={() => setCurrentStep((step) => Math.max(step - 1, 1))}
							onNext={() => void advance()}
							finalLabel="Submit application"
							savingLabel="Submitting…"
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
								onClick={() => setShowSuccess(false)}
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
									Application submitted
								</h2>
								<p className="mb-8 text-sm text-muted-foreground">
									The review team has it now. You will be notified here as soon
									as there is a decision.
								</p>
								<button
									type="button"
									onClick={() => setShowSuccess(false)}
									className="w-full cursor-pointer rounded-lg bg-primary px-8 py-3 font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
								>
									Done
								</button>
							</motion.div>
						</motion.div>
					)}
				</AnimatePresence>
			</ModalPortal>
		</div>
	);
}

function StatusCard({
	icon,
	title,
	body,
	action,
}: {
	icon: React.ReactNode;
	title: string;
	body: string;
	action?: React.ReactNode;
}) {
	return (
		<div className="flex min-h-screen items-center justify-center bg-background px-4 pt-app-header">
			<GoLivePanel className="w-full max-w-lg p-8 text-center">
				<div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
					{icon}
				</div>
				<h2 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">
					{title}
				</h2>
				<p className="mb-6 text-sm leading-relaxed text-muted-foreground">
					{body}
				</p>
				{action ?? (
					<Link
						to="/marketplace"
						className="inline-block w-full cursor-pointer rounded-lg border border-border px-8 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
					>
						Back to the marketplace
					</Link>
				)}
			</GoLivePanel>
		</div>
	);
}
