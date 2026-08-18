import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import {
	useSaveMarketplaceSurvey,
	useSkipMarketplaceSurvey,
} from "@/hooks/useMarketplaceSurvey";
import { useMarketplaceCategoryNavigationQuery } from "@/hooks/useMarketplaceTaxonomy";
import {
	COMPANY_SIZE_LABELS,
	INTENT_DESCRIPTIONS,
	INTENT_LABELS,
	INTENT_ORDER,
	TALENT_GOAL_LABELS,
} from "@/lib/marketplaceSurvey";
import { cn } from "@/lib/utils";
import type {
	SurveyCompanySize,
	SurveyIntent,
	SurveyTalentGoal,
} from "@/queries/marketplaceSurvey";
import { Button } from "@/ui/button";

/**
 * The marketplace intake survey.
 *
 * Five steps at most, three for a client-only respondent — the goal step is
 * inserted only when it has something to ask. Steps are a string-key array
 * rather than a counter for exactly that reason; the same shape `welcome.tsx`
 * uses for its conditionally-inserted theme slide.
 *
 * What it asks and why:
 *   intents     → which hero copy and CTA the storefront leads with
 *   categories  → the `?category=` filter on the consultant strip
 *   goal        → a next step for someone here to work rather than to hire
 *   companySize → nothing yet. Stored for segmentation, never rendered back.
 *
 * Skip is on every step and is terminal. There is no retake surface, so the
 * confirm before it is doing real work, not being polite.
 */

const MAX_CATEGORIES = 3;

type StepKey = "intents" | "categories" | "goal" | "company" | "done";

const COMPANY_SIZES = Object.keys(
	COMPANY_SIZE_LABELS,
) as readonly SurveyCompanySize[];
const TALENT_GOALS = Object.keys(
	TALENT_GOAL_LABELS,
) as readonly SurveyTalentGoal[];

const slideVariants = {
	enter: (dir: 1 | -1) => ({ x: dir === 1 ? 24 : -24, opacity: 0 }),
	center: { x: 0, opacity: 1 },
	exit: (dir: 1 | -1) => ({ x: dir === 1 ? -24 : 24, opacity: 0 }),
};
const slideTransition = { duration: 0.25, ease: "easeOut" } as const;

export interface MarketplaceSurveyModalProps {
	open: boolean;
	/** Called once the survey is saved, skipped, or dismissed. */
	onClose: () => void;
}

export function MarketplaceSurveyModal({
	open,
	onClose,
}: MarketplaceSurveyModalProps) {
	const [intents, setIntents] = useState<SurveyIntent[]>([]);
	const [categorySlugs, setCategorySlugs] = useState<string[]>([]);
	const [talentGoal, setTalentGoal] = useState<SurveyTalentGoal | null>(null);
	const [companySize, setCompanySize] = useState<SurveyCompanySize | null>(
		null,
	);
	const [index, setIndex] = useState(0);
	const [direction, setDirection] = useState<1 | -1>(1);
	const [confirmingSkip, setConfirmingSkip] = useState(false);

	const navigationQuery = useMarketplaceCategoryNavigationQuery();
	const save = useSaveMarketplaceSurvey();
	const skip = useSkipMarketplaceSurvey();
	const busy = save.isPending || skip.isPending;

	// Someone here only to hire has nothing to answer on the goal step, so it is
	// not shown to them rather than shown and made optional.
	const worksHere =
		intents.includes("consultant") || intents.includes("talent");
	const steps = useMemo<StepKey[]>(() => {
		const list: StepKey[] = ["intents", "categories"];
		if (worksHere) list.push("goal");
		list.push("company", "done");
		return list;
	}, [worksHere]);

	// The step list shrinks when someone unticks Talent, which can strand the
	// index past the end.
	const safeIndex = Math.min(index, steps.length - 1);
	const step = steps[safeIndex];

	const goNext = () => {
		setDirection(1);
		setIndex((current) => Math.min(current + 1, steps.length - 1));
	};
	const goBack = () => {
		setDirection(-1);
		setIndex((current) => Math.max(current - 1, 0));
	};

	const toggleIntent = (intent: SurveyIntent) => {
		setIntents((current) =>
			current.includes(intent)
				? current.filter((item) => item !== intent)
				: [...current, intent],
		);
	};

	const toggleCategory = (slug: string) => {
		setCategorySlugs((current) => {
			if (current.includes(slug)) {
				return current.filter((item) => item !== slug);
			}
			// Silently dropping the pick would read as a broken chip, so the cap is
			// shown as disabled chips instead and this is only the backstop.
			if (current.length >= MAX_CATEGORIES) return current;
			return [...current, slug];
		});
	};

	const finish = async () => {
		await save.mutateAsync({
			intents,
			category_slugs: categorySlugs,
			talent_goal: worksHere && talentGoal ? talentGoal : undefined,
			company_size: companySize ?? undefined,
			status: "completed",
		});
		onClose();
	};

	const confirmSkip = async () => {
		await skip.mutateAsync();
		onClose();
	};

	const canContinue = step !== "intents" || intents.length > 0;

	return (
		<AppDialog
			open={open}
			onClose={() => setConfirmingSkip(true)}
			size="lg"
			busy={busy}
			title={
				confirmingSkip ? "Skip the setup questions?" : "Set up your marketplace"
			}
			description={
				confirmingSkip
					? undefined
					: "Three quick questions so the marketplace opens on work you care about."
			}
			footer={
				confirmingSkip ? (
					<div className="flex justify-end gap-2">
						<Button
							variant="outlined"
							colorScheme="muted"
							size="sm"
							onClick={() => setConfirmingSkip(false)}
							disabled={busy}
						>
							Keep answering
						</Button>
						<Button
							variant="contained"
							colorScheme="primary"
							size="sm"
							onClick={confirmSkip}
							disabled={busy}
						>
							{skip.isPending ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								"Skip for good"
							)}
						</Button>
					</div>
				) : (
					<NavRow
						canGoBack={safeIndex > 0}
						onBack={goBack}
						onSkip={() => setConfirmingSkip(true)}
						onNext={step === "done" ? finish : goNext}
						nextLabel={step === "done" ? "Finish" : "Continue"}
						nextDisabled={!canContinue || busy}
						busy={save.isPending}
						isLast={step === "done"}
					/>
				)
			}
		>
			{confirmingSkip ? (
				<p className="text-sm text-muted-foreground">
					You won't be asked again. The marketplace will keep showing everything
					rather than what matches your work.
				</p>
			) : (
				<div className="space-y-6">
					<Stepper current={safeIndex + 1} total={steps.length} />

					<AnimatePresence mode="wait" initial={false} custom={direction}>
						<motion.div
							key={step}
							custom={direction}
							variants={slideVariants}
							initial="enter"
							animate="center"
							exit="exit"
							transition={slideTransition}
							className="min-h-[16rem]"
						>
							{step === "intents" && (
								<Question
									title="What brings you to the marketplace?"
									hint="Pick everything that applies."
								>
									<div className="grid gap-2">
										{INTENT_ORDER.map((intent) => (
											<ChoiceCard
												key={intent}
												selected={intents.includes(intent)}
												onClick={() => toggleIntent(intent)}
												label={INTENT_LABELS[intent]}
												description={INTENT_DESCRIPTIONS[intent]}
											/>
										))}
									</div>
								</Question>
							)}

							{step === "categories" && (
								<Question
									title="What kind of work?"
									hint={`Pick up to ${MAX_CATEGORIES}. This is what the marketplace will lead with.`}
								>
									{navigationQuery.isLoading ? (
										<div className="flex items-center gap-2 text-sm text-muted-foreground">
											<Loader2 className="h-4 w-4 animate-spin" />
											Loading categories…
										</div>
									) : (
										<div className="flex flex-wrap gap-2">
											{(navigationQuery.data ?? []).map((category) => {
												const selected = categorySlugs.includes(category.slug);
												const atCap =
													!selected && categorySlugs.length >= MAX_CATEGORIES;
												return (
													<button
														key={category.slug}
														type="button"
														disabled={atCap}
														onClick={() => toggleCategory(category.slug)}
														className={cn(
															"rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
															selected
																? "border-primary bg-primary text-primary-foreground"
																: "border-border text-foreground hover:border-primary hover:text-primary",
															atCap && "cursor-not-allowed opacity-40",
														)}
													>
														{category.name}
													</button>
												);
											})}
										</div>
									)}
								</Question>
							)}

							{step === "goal" && (
								<Question
									title="What would you like to do first?"
									hint="We'll point you at it when you're done here."
								>
									<div className="grid gap-2">
										{TALENT_GOALS.map((goal) => (
											<ChoiceCard
												key={goal}
												selected={talentGoal === goal}
												onClick={() =>
													setTalentGoal((current) =>
														current === goal ? null : goal,
													)
												}
												label={TALENT_GOAL_LABELS[goal]}
											/>
										))}
									</div>
								</Question>
							)}

							{step === "company" && (
								<Question
									title="How big is your team?"
									hint="Optional. It helps us understand who the marketplace is serving."
								>
									<div className="flex flex-wrap gap-2">
										{COMPANY_SIZES.map((size) => (
											<button
												key={size}
												type="button"
												onClick={() =>
													setCompanySize((current) =>
														current === size ? null : size,
													)
												}
												className={cn(
													"rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
													companySize === size
														? "border-primary bg-primary text-primary-foreground"
														: "border-border text-foreground hover:border-primary hover:text-primary",
												)}
											>
												{COMPANY_SIZE_LABELS[size]}
											</button>
										))}
									</div>
								</Question>
							)}

							{step === "done" && (
								<Question
									title="That's everything"
									hint="You can't retake this yet, so here's what we recorded."
								>
									<Recap
										intents={intents}
										categoryNames={(navigationQuery.data ?? [])
											.filter((category) =>
												categorySlugs.includes(category.slug),
											)
											.map((category) => category.name)}
										talentGoal={worksHere ? talentGoal : null}
										companySize={companySize}
									/>
									{save.isError && (
										<p className="mt-4 text-sm text-destructive">
											That didn't save. Try Finish again.
										</p>
									)}
								</Question>
							)}
						</motion.div>
					</AnimatePresence>
				</div>
			)}
		</AppDialog>
	);
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function Stepper({ current, total }: { current: number; total: number }) {
	return (
		<div className="flex items-center gap-3">
			<div className="flex flex-1 gap-1.5">
				{Array.from({ length: total }, (_, position) => (
					<div
						key={`step-${position}`}
						className={cn(
							"h-1.5 flex-1 rounded-full transition-colors",
							position < current ? "bg-primary" : "bg-muted",
						)}
					/>
				))}
			</div>
			<span className="text-xs font-medium text-muted-foreground">
				{current} of {total}
			</span>
		</div>
	);
}

function Question({
	title,
	hint,
	children,
}: {
	title: string;
	hint?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="space-y-4">
			<div>
				<h3 className="text-lg font-semibold text-foreground">{title}</h3>
				{hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
			</div>
			{children}
		</div>
	);
}

function ChoiceCard({
	selected,
	onClick,
	label,
	description,
}: {
	selected: boolean;
	onClick: () => void;
	label: string;
	description?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={selected}
			// Named explicitly rather than left to name-from-contents: the label
			// sits two spans deep next to a decorative check, and the accessibility
			// tree was reporting these as unnamed buttons while the flat category
			// chips next door came through fine.
			aria-label={label}
			className={cn(
				"flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors",
				selected
					? "border-primary bg-primary/5"
					: "border-border hover:border-primary/50",
			)}
		>
			<span
				className={cn(
					"mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
					selected
						? "border-primary bg-primary text-primary-foreground"
						: "border-border",
				)}
			>
				{selected && <Check className="h-3.5 w-3.5" />}
			</span>
			<span className="min-w-0">
				<span className="block text-sm font-semibold text-foreground">
					{label}
				</span>
				{description && (
					<span className="mt-0.5 block text-sm text-muted-foreground">
						{description}
					</span>
				)}
			</span>
		</button>
	);
}

function Recap({
	intents,
	categoryNames,
	talentGoal,
	companySize,
}: {
	intents: SurveyIntent[];
	categoryNames: string[];
	talentGoal: SurveyTalentGoal | null;
	companySize: SurveyCompanySize | null;
}) {
	const rows: Array<[string, string]> = [
		["Here as", intents.map((intent) => INTENT_LABELS[intent]).join(", ")],
		["Interested in", categoryNames.join(", ") || "Everything"],
	];
	if (talentGoal) rows.push(["First step", TALENT_GOAL_LABELS[talentGoal]]);
	if (companySize) rows.push(["Team size", COMPANY_SIZE_LABELS[companySize]]);

	return (
		<dl className="divide-y divide-border rounded-xl border border-border">
			{rows.map(([term, value]) => (
				<div key={term} className="flex gap-4 px-4 py-3 text-sm">
					<dt className="w-28 shrink-0 text-muted-foreground">{term}</dt>
					<dd className="min-w-0 font-medium text-foreground">{value}</dd>
				</div>
			))}
		</dl>
	);
}

function NavRow({
	canGoBack,
	onBack,
	onSkip,
	onNext,
	nextLabel,
	nextDisabled,
	busy,
	isLast,
}: {
	canGoBack: boolean;
	onBack: () => void;
	onSkip: () => void;
	onNext: () => void;
	nextLabel: string;
	nextDisabled: boolean;
	busy: boolean;
	isLast: boolean;
}) {
	return (
		<div className="flex items-center justify-between gap-3">
			<Button
				variant="text"
				colorScheme="muted"
				size="sm"
				onClick={onBack}
				disabled={!canGoBack}
				className={cn(!canGoBack && "invisible")}
			>
				<ArrowLeft className="mr-1.5 h-4 w-4" />
				Back
			</Button>

			<Button variant="text" colorScheme="muted" size="sm" onClick={onSkip}>
				Skip
			</Button>

			<Button
				variant="contained"
				colorScheme="primary"
				size="sm"
				onClick={onNext}
				disabled={nextDisabled}
			>
				{busy ? (
					<Loader2 className="h-4 w-4 animate-spin" />
				) : (
					<>
						{nextLabel}
						{!isLast && <ArrowRight className="ml-1.5 h-4 w-4" />}
					</>
				)}
			</Button>
		</div>
	);
}
