import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Loader2, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	leaveForGoodbye,
	tearDownDeletedAccount,
} from "@/components/settings/delete-account/accountTeardown";
import { ContainerResolutionRow } from "@/components/settings/delete-account/ContainerResolutionRow";
import {
	SettingsNotice,
	SettingsPageHeader,
	SettingsSection,
	settingsButton,
	settingsInput,
} from "@/components/workspace/settings/SettingsPrimitives";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
	deletionCopy,
	matchesConfirmationPhrase,
} from "@/lib/accountDeletionCopy";
import { isNativeApp } from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
	type ContainerResolution,
	type DeletionFailure,
	type DeletionPreflight,
	deleteAccount,
	getDeletionPreflight,
	requestDeletionCode,
	toDeletionFailure,
} from "@/services/accountDeletion.service";
import { useUser } from "@/stores/authStore";

/**
 * In-app account deletion.
 *
 * A route rather than a dialog: the resolution step can be twenty containers
 * long, and a modal would make that a scroll box inside a scroll box on a
 * phone. A route is also linkable, which matters because `/privacy`, `/terms`
 * and the docs article all tell people to come here by name.
 *
 * One route rather than a step per URL: deep-linking into a confirmation
 * without the preflight that justifies it is meaningless, and a reload dropping
 * you back to the start is the correct behaviour for something irreversible.
 *
 * Classified `app` in `platformSurfaces.ts` by inheriting the `/settings` rule.
 * That is deliberate and load-bearing: Google Play requires this to exist in the
 * installed app.
 */
export const Route = createFileRoute("/settings/delete-account")({
	component: DeleteAccountPage,
});

type Step = "review" | "decide" | "confirm" | "running";

function DeleteAccountPage() {
	useDocumentTitle("Delete account");
	const user = useUser();
	const queryClient = useQueryClient();
	const native = isNativeApp();
	const surface = native ? "app" : "web";

	const [preflight, setPreflight] = useState<DeletionPreflight | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [step, setStep] = useState<Step>("review");
	const [resolutions, setResolutions] = useState<
		Record<string, ContainerResolution>
	>({});
	const [phrase, setPhrase] = useState("");
	const [credential, setCredential] = useState("");
	const [codeSent, setCodeSent] = useState(false);
	const [failure, setFailure] = useState<DeletionFailure | null>(null);
	const [slow, setSlow] = useState(false);
	const [checking, setChecking] = useState(false);
	const stepRef = useRef<HTMLDivElement | null>(null);

	const usesPassword = preflight?.auth.has_password ?? true;

	const load = useCallback(async () => {
		try {
			const next = await getDeletionPreflight();
			setPreflight(next);
			setLoadError(null);
			return next;
		} catch (error) {
			setLoadError(toDeletionFailure(error).message);
			return null;
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	// Runs on every step change, not just on mount: the step container is what
	// receives focus, so the announcement follows the user through the flow.
	// Focus follows the step, including on mount.
	useEffect(() => {
		stepRef.current?.focus();
	}, [step]);

	const key = (container: { kind: string; id: string }) =>
		`${container.kind}:${container.id}`;

	const decisions = preflight?.decisions ?? [];
	const undecided = decisions.filter((decision) => {
		const chosen = resolutions[key(decision)];
		if (!chosen) return true;
		return chosen.action === "transfer" && !chosen.new_owner_id;
	});

	const credentialReady = credential.trim().length > 0;
	const phraseReady = matchesConfirmationPhrase(phrase);
	const canSubmit = phraseReady && credentialReady && step === "confirm";

	const disabledReason = !phraseReady
		? deletionCopy.disabledBecausePhrase
		: !credentialReady
			? usesPassword
				? deletionCopy.disabledBecauseCredential
				: deletionCopy.disabledBecauseCode
			: null;

	const paidWorkspace = useMemo(
		() => decisions.find((decision) => decision.is_paid),
		[decisions],
	);

	async function submit() {
		setStep("running");
		setFailure(null);
		setSlow(false);
		const slowTimer = window.setTimeout(() => setSlow(true), 8000);

		try {
			await deleteAccount({
				confirmation: phrase,
				password: usesPassword ? credential : undefined,
				code: usesPassword ? undefined : credential,
				containers: Object.values(resolutions),
			});
			window.clearTimeout(slowTimer);
			await tearDownDeletedAccount(queryClient, user?.id ?? "");
			leaveForGoodbye();
		} catch (error) {
			window.clearTimeout(slowTimer);
			const next = toDeletionFailure(error);
			setFailure(next);

			// The identity is already gone and only cleanup failed. From the
			// user's point of view that is success, so finish the flow rather
			// than offering a retry into nothing.
			if (next.accountIntact === false) {
				await tearDownDeletedAccount(queryClient, user?.id ?? "");
				leaveForGoodbye();
				return;
			}

			// A stale plan: re-read, keep what still applies, send them back.
			if (
				next.code === "resolution_unknown_container" ||
				next.code === "resolution_invalid_nominee" ||
				next.code === "resolution_incomplete" ||
				next.code === "container_not_deletable"
			) {
				const fresh = await load();
				if (fresh) {
					const live = new Set(fresh.decisions.map(key));
					setResolutions((current) =>
						Object.fromEntries(
							Object.entries(current).filter(([id]) => live.has(id)),
						),
					);
				}
				setStep(fresh && fresh.decisions.length > 0 ? "decide" : "review");
				return;
			}

			setStep(next.accountIntact === null ? "running" : "confirm");
		}
	}

	/**
	 * The scary case: no response arrived, so the client cannot know whether the
	 * server ran it. Ask. Never auto-retry — auto-retrying an irreversible
	 * operation is how you delete something twice.
	 */
	async function checkStatus() {
		setChecking(true);
		try {
			const fresh = await getDeletionPreflight();
			// It survived. Show them where things actually stand.
			setPreflight(fresh);
			setFailure(null);
			setStep("review");
			setLoadError(deletionCopy.stillHere);
		} catch (error) {
			const next = toDeletionFailure(error);
			if (next.status === 401 || next.status === 404) {
				await tearDownDeletedAccount(queryClient, user?.id ?? "");
				leaveForGoodbye();
				return;
			}
			setFailure({ ...next, message: deletionCopy.lostConnectionStillOffline });
		} finally {
			setChecking(false);
		}
	}

	// Block navigation while the request is in flight, so a stray back gesture
	// cannot leave mid-write.
	useEffect(() => {
		if (step !== "running") return;
		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => window.removeEventListener("beforeunload", onBeforeUnload);
	}, [step]);

	if (loadError && !preflight) {
		return (
			<div className="app-fade-in">
				<SettingsNotice tone="danger" title="We could not load this page">
					{loadError}
				</SettingsNotice>
			</div>
		);
	}

	if (!preflight) {
		return (
			<div className="app-fade-in text-sm text-muted-foreground">
				Working out what deleting your account would do&hellip;
			</div>
		);
	}

	if (step === "running") {
		return (
			<div className="app-fade-in max-w-2xl">
				{failure && failure.accountIntact === null ? (
					<SettingsSection
						tone="danger"
						title={deletionCopy.lostConnectionTitle}
						description={deletionCopy.lostConnectionBody}
					>
						<button
							type="button"
							className={settingsButton.primary}
							disabled={checking}
							onClick={() => void checkStatus()}
						>
							{checking ? (
								<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
							) : null}
							{deletionCopy.lostConnectionCta}
						</button>
					</SettingsSection>
				) : (
					<div
						className="flex items-start gap-3 rounded-2xl border border-border bg-card p-6"
						role="status"
						aria-live="polite"
					>
						<Loader2
							className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary"
							aria-hidden
						/>
						<div>
							<p className="text-sm font-semibold text-foreground">
								{deletionCopy.runningTitle}
							</p>
							<p className="mt-1 text-sm text-muted-foreground">
								{deletionCopy.runningBody(surface)}
							</p>
							{slow ? (
								<p className="mt-2 text-sm text-muted-foreground">
									{deletionCopy.runningSlow}
								</p>
							) : null}
						</div>
					</div>
				)}
			</div>
		);
	}

	return (
		// tabIndex -1 plus the focus effect above: this flow does not live in
		// AppDialog, so nothing moves focus when the step changes. Without it a
		// keyboard or screen-reader user is left on the previous step's button
		// with no announcement that the page changed under them.
		<div
			ref={stepRef}
			tabIndex={-1}
			aria-live="polite"
			className="app-fade-in max-w-3xl outline-none"
		>
			<Link
				to="/settings"
				className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
			>
				<ArrowLeft className="h-4 w-4" aria-hidden />
				Back to settings
			</Link>

			<SettingsPageHeader
				title={
					step === "confirm"
						? deletionCopy.confirmTitle
						: deletionCopy.reviewTitle
				}
				description={
					step === "confirm"
						? deletionCopy.confirmIntro
						: deletionCopy.reviewIntro
				}
			/>

			{loadError === deletionCopy.stillHere ? (
				<SettingsNotice tone="warning" className="mt-4">
					{deletionCopy.stillHere}
				</SettingsNotice>
			) : null}

			{failure && failure.accountIntact === true ? (
				<SettingsNotice
					tone="danger"
					icon={AlertTriangle}
					title="Nothing was deleted"
					className="mt-4"
					role="alert"
				>
					{failure.code === "reauth_failed" ||
					failure.status === 401 ||
					failure.status === 403
						? failure.message
						: `${deletionCopy.failedIntact} ${failure.message}`}
				</SettingsNotice>
			) : null}

			{preflight.warnings.includes("LAST_PLATFORM_ADMIN") ? (
				<SettingsNotice
					tone="warning"
					icon={ShieldAlert}
					className="mt-4"
					title="You are the last administrator"
				>
					{deletionCopy.lastAdminWarning}
				</SettingsNotice>
			) : null}

			{step === "review" ? (
				<ReviewStep
					preflight={preflight}
					surface={surface}
					paidWorkspaceName={paidWorkspace?.name ?? null}
					onContinue={() =>
						setStep(decisions.length > 0 ? "decide" : "confirm")
					}
				/>
			) : null}

			{step === "decide" ? (
				<section className="mt-6">
					<SettingsSection
						tone="danger"
						title={deletionCopy.decisionsHeading}
						description={deletionCopy.decisionsIntro(decisions.length)}
					>
						<ul className="mt-1">
							{decisions.map((decision) => (
								<ContainerResolutionRow
									key={key(decision)}
									decision={decision}
									resolution={resolutions[key(decision)]}
									onChange={(next) =>
										setResolutions((current) => {
											const copy = { ...current };
											if (!next) delete copy[key(decision)];
											else copy[key(decision)] = next;
											return copy;
										})
									}
								/>
							))}
						</ul>
					</SettingsSection>

					<div className="mt-5 flex flex-wrap items-center gap-3">
						<button
							type="button"
							className={settingsButton.primary}
							disabled={undecided.length > 0}
							onClick={() => setStep("confirm")}
						>
							Continue
						</button>
						<button
							type="button"
							className={settingsButton.secondary}
							onClick={() => setStep("review")}
						>
							Back
						</button>
						{undecided.length > 0 ? (
							<p className="text-sm text-muted-foreground">
								{deletionCopy.disabledBecauseUndecided(undecided.length)}
							</p>
						) : null}
					</div>
				</section>
			) : null}

			{step === "confirm" ? (
				<section className="mt-6 space-y-5">
					<SettingsSection title="What you are about to do">
						<ul className="mt-1 space-y-2 text-sm">
							{decisions
								.filter(
									(decision) => resolutions[key(decision)]?.action === "delete",
								)
								.map((decision) => (
									<li key={key(decision)} className="text-destructive">
										<strong>
											Delete {decision.name}, with everything in it.
										</strong>
									</li>
								))}
							{decisions
								.filter(
									(decision) =>
										resolutions[key(decision)]?.action === "transfer",
								)
								.map((decision) => {
									const owner = decision.candidates.find(
										(candidate) =>
											candidate.user_id ===
											resolutions[key(decision)]?.new_owner_id,
									);
									return (
										<li key={key(decision)} className="text-muted-foreground">
											Make {owner?.display_name ?? "someone"} the owner of{" "}
											{decision.name}.
										</li>
									);
								})}
							{preflight.will_transfer.projects.length > 0 ? (
								<li className="text-muted-foreground">
									Hand {preflight.will_transfer.projects.length} shared{" "}
									{preflight.will_transfer.projects.length === 1
										? "project"
										: "projects"}{" "}
									to people who already work on them.
								</li>
							) : null}
							<li className="text-destructive">
								<strong>
									Delete your account, your profile and your sign-in.
								</strong>
							</li>
							<li className="text-muted-foreground">
								Keep what you wrote in shared projects, as &ldquo;Deleted
								user&rdquo;.
							</li>
						</ul>
					</SettingsSection>

					<div className="space-y-4 rounded-2xl border border-destructive/30 bg-card p-5">
						<div>
							<label
								htmlFor="delete-phrase"
								className="block text-sm font-medium text-foreground"
							>
								{deletionCopy.confirmPhraseLabel}
							</label>
							<input
								id="delete-phrase"
								type="text"
								value={phrase}
								onChange={(event) => setPhrase(event.target.value)}
								autoComplete="off"
								autoCapitalize="off"
								autoCorrect="off"
								spellCheck={false}
								className={cn(settingsInput, "mt-2 max-w-sm")}
							/>
						</div>

						<div>
							<label
								htmlFor="delete-credential"
								className="block text-sm font-medium text-foreground"
							>
								{usesPassword
									? deletionCopy.confirmPasswordLabel
									: deletionCopy.confirmCodeLabel}
							</label>
							<input
								id="delete-credential"
								type={usesPassword ? "password" : "text"}
								inputMode={usesPassword ? undefined : "numeric"}
								value={credential}
								onChange={(event) => setCredential(event.target.value)}
								autoComplete={
									usesPassword ? "current-password" : "one-time-code"
								}
								className={cn(settingsInput, "mt-2 max-w-sm")}
							/>
							<p className="mt-1.5 text-xs text-muted-foreground">
								{usesPassword
									? deletionCopy.confirmPasswordHint
									: deletionCopy.confirmCodeHint}
							</p>
							{!usesPassword ? (
								<button
									type="button"
									className={cn(settingsButton.link, "mt-2")}
									onClick={() => {
										void requestDeletionCode().then(() => setCodeSent(true));
									}}
								>
									{codeSent ? "Send another code" : "Email me a code"}
								</button>
							) : null}
						</div>

						<SettingsNotice tone="danger" role="alert">
							{deletionCopy.confirmFinalWarning}
						</SettingsNotice>

						<div className="flex flex-wrap items-center gap-3">
							<button
								type="button"
								disabled={!canSubmit}
								onClick={() => void submit()}
								className="inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-destructive px-3.5 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:pointer-events-none disabled:opacity-60"
							>
								{deletionCopy.confirmCta}
							</button>
							<button
								type="button"
								className={settingsButton.secondary}
								onClick={() =>
									setStep(decisions.length > 0 ? "decide" : "review")
								}
							>
								Back
							</button>
							{disabledReason ? (
								<p className="text-sm text-muted-foreground">
									{disabledReason}
								</p>
							) : null}
						</div>
					</div>
				</section>
			) : null}
		</div>
	);
}

function ReviewStep({
	preflight,
	surface,
	paidWorkspaceName,
	onContinue,
}: {
	preflight: DeletionPreflight;
	surface: "web" | "app";
	paidWorkspaceName: string | null;
	onContinue: () => void;
}) {
	const deleted = deletionCopy.deletedBullets({
		workspaces: preflight.will_be_deleted.workspaces.length,
		teams: preflight.will_be_deleted.teams.length,
		projects: preflight.will_be_deleted.projects,
		roadmaps: preflight.will_be_deleted.standalone_roadmaps,
		devices: preflight.will_be_deleted.devices,
		apiTokens: preflight.will_be_deleted.api_tokens,
	});

	const kept = deletionCopy.keptBullets({
		chatMessages: preflight.will_be_kept.chat_messages,
		comments: preflight.will_be_kept.comments,
		decisions: preflight.will_be_kept.decisions,
		deliverables: preflight.will_be_kept.deliverables,
		changeRequests: preflight.will_be_kept.change_requests,
		risks: preflight.will_be_kept.risks,
		activityEntries: preflight.will_be_kept.activity_entries,
		contracts: preflight.will_be_kept.contracts,
		invoices: preflight.will_be_kept.invoices,
		payouts: preflight.will_be_kept.payouts,
	});

	const billing = paidWorkspaceName
		? deletionCopy.billingNote(paidWorkspaceName, surface)
		: null;

	return (
		<div className="mt-6 space-y-5">
			<SettingsSection tone="danger" title={deletionCopy.deletedHeading}>
				<ul className="mt-1 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
					{deleted.map((line) => (
						<li key={line}>{line}</li>
					))}
				</ul>
			</SettingsSection>

			<SettingsSection title={deletionCopy.transferHeading}>
				<p className="mt-1 text-sm text-muted-foreground">
					{deletionCopy.transferBody(preflight.will_transfer.projects.length)}
				</p>
			</SettingsSection>

			<SettingsSection title={deletionCopy.keptHeading}>
				<p className="mt-1 text-sm text-muted-foreground">
					{deletionCopy.keptIntro}
				</p>
				<ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
					{kept.map((line) => (
						<li key={line}>{line}</li>
					))}
				</ul>
				<p className="mt-3 text-sm text-muted-foreground">
					{deletionCopy.keptReason}
				</p>
			</SettingsSection>

			{billing ? (
				<SettingsNotice tone="warning" title="About the plan">
					{billing.text}
					{billing.link ? (
						<>
							{" "}
							<Link to={billing.link.to} className={settingsButton.link}>
								{billing.link.label}
							</Link>
						</>
					) : null}
				</SettingsNotice>
			) : null}

			<button
				type="button"
				className={settingsButton.primary}
				onClick={onContinue}
			>
				Continue
			</button>
		</div>
	);
}
