import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, Plus, Star, X } from "lucide-react";
import { useMemo, useState } from "react";
import { getMarketplaceCategoryNavigation } from "@/api/endpoints/marketplace-taxonomy";
import {
	GoLiveChoiceCard,
	GoLiveField,
	GoLiveInput,
} from "@/components/marketplace/wizard/GoLiveForm";
import { EXPERIENCE_BUCKETS } from "@/lib/experienceBuckets";
import type { AvailabilityStatus } from "@/services/profile.service";
import type { ApplyAction, ConsultantApplyDraft } from "../applicationDraft";

const MAX_PLACEMENTS = 8;

/**
 * Step 3: where you belong in the marketplace, and the commercial half.
 *
 * Expertise comes from the live taxonomy rather than a hardcoded niche list:
 * these picks are what approval writes to consultant_subcategories, so an
 * approved consultant appears in the directory immediately instead of landing
 * on an empty storefront.
 */
export function StepConsultantDetails({
	draft,
	dispatch,
}: {
	draft: ConsultantApplyDraft;
	dispatch: React.Dispatch<ApplyAction>;
}) {
	return (
		<div className="space-y-5">
			<ExpertisePlacementSection draft={draft} dispatch={dispatch} />
			<WorkLinksSection draft={draft} dispatch={dispatch} />
			<CapacityRateSection draft={draft} dispatch={dispatch} />
		</div>
	);
}

function ExpertisePlacementSection({
	draft,
	dispatch,
}: {
	draft: ConsultantApplyDraft;
	dispatch: React.Dispatch<ApplyAction>;
}) {
	const navigation = useQuery({
		queryKey: ["marketplace", "category-navigation"],
		queryFn: getMarketplaceCategoryNavigation,
		staleTime: 5 * 60 * 1000,
	});
	const categories = navigation.data ?? [];
	const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);

	const activeCategory =
		categories.find((category) => category.id === activeCategoryId) ??
		categories[0];

	/** Name lookup for the picked-chips row, across every category. */
	const subcategoryNames = useMemo(() => {
		const names = new Map<string, string>();
		for (const category of categories) {
			for (const subcategory of category.subcategories) {
				names.set(subcategory.id, subcategory.name);
			}
		}
		return names;
	}, [categories]);

	const setApply = (
		patch: Partial<
			Pick<ConsultantApplyDraft, "placements" | "primarySubcategoryId">
		>,
	) => dispatch({ type: "setApply", patch });

	const isPicked = (subcategoryId: string) =>
		draft.placements.some((p) => p.subcategoryId === subcategoryId);

	const togglePick = (subcategoryId: string) => {
		if (isPicked(subcategoryId)) {
			const remaining = draft.placements.filter(
				(p) => p.subcategoryId !== subcategoryId,
			);
			setApply({
				placements: remaining,
				primarySubcategoryId:
					draft.primarySubcategoryId === subcategoryId
						? (remaining[0]?.subcategoryId ?? null)
						: draft.primarySubcategoryId,
			});
			return;
		}
		if (draft.placements.length >= MAX_PLACEMENTS) return;
		setApply({
			placements: [
				...draft.placements,
				{ subcategoryId, yearsExperience: null },
			],
			primarySubcategoryId: draft.primarySubcategoryId ?? subcategoryId,
		});
	};

	const setYears = (subcategoryId: string, years: number | null) =>
		setApply({
			placements: draft.placements.map((p) =>
				p.subcategoryId === subcategoryId
					? { ...p, yearsExperience: years }
					: p,
			),
		});

	return (
		<section className="rounded-2xl border border-border bg-card p-5">
			<h3 className="text-[15px] font-semibold text-foreground">
				Your expertise
			</h3>
			<p className="mt-1 mb-4 text-sm text-muted-foreground">
				Pick up to {MAX_PLACEMENTS} specialities. On approval these place you in
				the marketplace directory, so choose what you want to be hired for.
			</p>

			{navigation.isLoading && (
				<div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" /> Loading categories…
				</div>
			)}
			{navigation.isError && (
				<p className="py-4 text-sm text-destructive">
					We could not load the marketplace categories. Try again in a moment.
				</p>
			)}

			{categories.length > 0 && (
				<>
					{draft.placements.length > 0 && (
						<ul className="mb-4 divide-y divide-border rounded-xl border border-border bg-background">
							{draft.placements.map((placement) => {
								const id = placement.subcategoryId;
								const isPrimary = draft.primarySubcategoryId === id;
								const name = subcategoryNames.get(id) ?? "…";
								return (
									<li key={id} className="flex items-center gap-2.5 px-3 py-2">
										<button
											type="button"
											onClick={() => setApply({ primarySubcategoryId: id })}
											aria-label={
												isPrimary
													? `${name} is your primary speciality`
													: `Make ${name} your primary speciality`
											}
											title={isPrimary ? "Primary speciality" : "Make primary"}
											className="shrink-0 cursor-pointer text-primary"
										>
											<Star
												className="h-3.5 w-3.5"
												fill={isPrimary ? "currentColor" : "none"}
											/>
										</button>
										<span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
											{name}
										</span>
										<select
											value={placement.yearsExperience ?? ""}
											onChange={(event) =>
												setYears(
													id,
													event.target.value === ""
														? null
														: Number(event.target.value),
												)
											}
											aria-label={`Years of experience in ${name}`}
											className={`shrink-0 cursor-pointer rounded-lg border bg-card px-2 py-1.5 text-xs outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/25 ${
												placement.yearsExperience === null
													? "border-amber-500/50 text-muted-foreground"
													: "border-input text-card-foreground"
											}`}
										>
											<option value="" disabled>
												Years…
											</option>
											{EXPERIENCE_BUCKETS.map((bucket) => (
												<option key={bucket.value} value={bucket.value}>
													{bucket.label}
												</option>
											))}
										</select>
										<button
											type="button"
											onClick={() => togglePick(id)}
											aria-label={`Remove ${name}`}
											className="shrink-0 cursor-pointer rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
										>
											<X className="h-3.5 w-3.5" />
										</button>
									</li>
								);
							})}
						</ul>
					)}

					<div className="flex flex-wrap gap-1.5 border-b border-border pb-3">
						{categories.map((category) => (
							<button
								key={category.id}
								type="button"
								onClick={() => setActiveCategoryId(category.id)}
								className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
									activeCategory?.id === category.id
										? "bg-primary text-primary-foreground"
										: "bg-muted text-muted-foreground hover:text-foreground"
								}`}
							>
								{category.name}
							</button>
						))}
					</div>

					<div className="mt-3 flex flex-wrap gap-2">
						{(activeCategory?.subcategories ?? []).map((subcategory) => {
							const picked = isPicked(subcategory.id);
							const full = !picked && draft.placements.length >= MAX_PLACEMENTS;
							return (
								<button
									key={subcategory.id}
									type="button"
									onClick={() => togglePick(subcategory.id)}
									disabled={full}
									aria-pressed={picked}
									className={`cursor-pointer rounded-xl border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
										picked
											? "border-primary bg-primary/5 text-foreground"
											: "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
									}`}
								>
									{subcategory.name}
								</button>
							);
						})}
					</div>

					<p className="mt-3 text-xs text-muted-foreground">
						{draft.placements.length}/{MAX_PLACEMENTS} picked · set your years
						in each · the starred one is your primary speciality.
					</p>
				</>
			)}
		</section>
	);
}

function WorkLinksSection({
	draft,
	dispatch,
}: {
	draft: ConsultantApplyDraft;
	dispatch: React.Dispatch<ApplyAction>;
}) {
	const [pending, setPending] = useState("");
	const [error, setError] = useState<string | null>(null);

	const addLink = () => {
		const raw = pending.trim();
		if (!raw) return;
		// The API validates with @IsUrl(), which rejects a bare domain — so
		// normalise here rather than letting the save fail two steps later.
		const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
		try {
			new URL(url);
		} catch {
			setError("That does not look like a web address.");
			return;
		}
		if (draft.links.includes(url)) {
			setPending("");
			return;
		}
		setError(null);
		dispatch({ type: "set", patch: { links: [...draft.links, url] } });
		setPending("");
	};

	return (
		<section className="rounded-2xl border border-border bg-card p-5">
			<h3 className="text-[15px] font-semibold text-foreground">
				Verifiable links
			</h3>
			<p className="mt-1 mb-4 text-sm text-muted-foreground">
				Your LinkedIn plus at least one thing a reviewer can open — a case
				study, a site you shipped, a repo. Work links appear on your public
				profile after approval.
			</p>

			<GoLiveField label="LinkedIn profile" required htmlFor="apply-linkedin">
				<GoLiveInput
					id="apply-linkedin"
					value={draft.linkedinUrl}
					onChange={(event) =>
						dispatch({
							type: "setApply",
							patch: { linkedinUrl: event.target.value },
						})
					}
					placeholder="https://linkedin.com/in/you"
					inputMode="url"
				/>
			</GoLiveField>

			<div className="mt-4">
				<GoLiveField label="Work links" required hint="At least one is needed.">
					<div className="flex gap-2">
						<GoLiveInput
							value={pending}
							onChange={(event) => setPending(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									addLink();
								}
							}}
							placeholder="acase.study/you or github.com/you"
							aria-label="Add a link to your work"
						/>
						<button
							type="button"
							onClick={addLink}
							disabled={!pending.trim()}
							className="shrink-0 cursor-pointer rounded-xl border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
						>
							<Plus className="h-4 w-4" />
							<span className="sr-only">Add link</span>
						</button>
					</div>
				</GoLiveField>
				{error && <p className="mt-2 text-xs text-destructive">{error}</p>}

				{draft.links.length > 0 && (
					<ul className="mt-4 space-y-2">
						{draft.links.map((link) => (
							<li
								key={link}
								className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2"
							>
								<a
									href={link}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex min-w-0 items-center gap-1.5 text-sm text-primary hover:underline"
								>
									<ExternalLink className="h-3.5 w-3.5 shrink-0" />
									<span className="truncate">{link}</span>
								</a>
								<button
									type="button"
									onClick={() =>
										dispatch({
											type: "set",
											patch: { links: draft.links.filter((l) => l !== link) },
										})
									}
									aria-label={`Remove ${link}`}
									className="shrink-0 cursor-pointer rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								>
									<X className="h-3.5 w-3.5" />
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</section>
	);
}

function CapacityRateSection({
	draft,
	dispatch,
}: {
	draft: ConsultantApplyDraft;
	dispatch: React.Dispatch<ApplyAction>;
}) {
	const set = (patch: Partial<ConsultantApplyDraft>) =>
		dispatch({ type: "set", patch });

	return (
		<section className="space-y-5 rounded-2xl border border-border bg-card p-5">
			<div>
				<h3 className="text-[15px] font-semibold text-foreground">
					Capacity and rate
				</h3>
				<p className="mt-1 text-sm text-muted-foreground">
					What you charge and how much time you have to lead. You can change
					both whenever you like.
				</p>
			</div>

			<GoLiveField label="Availability" required>
				<div className="grid gap-3 sm:grid-cols-2">
					{(
						[
							["available", "Available", "Ready to lead new engagements"],
							[
								"partially_available",
								"Partially available",
								"Open to part-time leads",
							],
							["unavailable", "Unavailable", "Not looking right now"],
						] as [AvailabilityStatus, string, string][]
					).map(([value, label, hint]) => (
						<GoLiveChoiceCard
							key={value}
							name="apply-availability"
							value={value}
							label={label}
							description={hint}
							checked={draft.availability === value}
							onChange={() => set({ availability: value })}
						/>
					))}
				</div>
			</GoLiveField>

			<div className="grid gap-4 sm:grid-cols-3">
				<GoLiveField label="Hourly rate" required htmlFor="apply-rate">
					<GoLiveInput
						id="apply-rate"
						value={draft.hourlyRate}
						onChange={(event) => set({ hourlyRate: event.target.value })}
						inputMode="decimal"
						placeholder="120"
					/>
				</GoLiveField>
				<GoLiveField label="Currency" required htmlFor="apply-currency">
					<GoLiveInput
						id="apply-currency"
						value={draft.currency}
						onChange={(event) =>
							set({ currency: event.target.value.toUpperCase() })
						}
						maxLength={3}
						placeholder="USD"
					/>
				</GoLiveField>
				<GoLiveField label="Hours a week" required htmlFor="apply-hours">
					<GoLiveInput
						id="apply-hours"
						value={draft.weeklyHours}
						onChange={(event) => set({ weeklyHours: event.target.value })}
						inputMode="numeric"
						placeholder="30"
					/>
				</GoLiveField>
			</div>
		</section>
	);
}
