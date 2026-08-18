import { Check, ChevronDown, ShieldCheck } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useMarketplaceCategoryNavigationQuery } from "@/hooks/useMarketplaceTaxonomy";
import {
	BUDGET_BRACKETS,
	type ConsultantBrowseSearch,
	countActiveFilters,
	DELIVERY_OPTIONS,
} from "@/lib/consultantBrowseFilters";
import type { ConsultantDirectoryFacets } from "@/queries/consultants";

interface ConsultantFilterRailProps {
	search: ConsultantBrowseSearch;
	facets?: ConsultantDirectoryFacets;
	onChange: (next: Partial<ConsultantBrowseSearch>) => void;
	onClear: () => void;
}

interface Option {
	value: string | undefined;
	label: string;
	/** How many consultants match, when the facet knows. */
	count?: number;
}

/** How many rows a list shows before it collapses behind "+N more". */
const COLLAPSED_ROWS = 5;

/**
 * The browse page's filter rail.
 *
 * Every control here maps to a real column: sub-category membership, the
 * published catalog's price and delivery, the shared rate card, spoken
 * languages, and the profile's country. There is deliberately no rating,
 * response-time or "online now" filter — nothing records those, and a control
 * that silently matches everything is worse than one that is missing.
 *
 * Lists never scroll inside themselves. A nested scroll area inside a rail that
 * already scrolls is the classic way to hide options nobody can find; long
 * lists collapse to a few rows behind "+N more" instead, which keeps the whole
 * rail one continuous column.
 *
 * Facet options and their counts come from the API rather than a hardcoded
 * list, so the rail can only ever offer a category, country or language
 * somebody is actually in.
 */
export function ConsultantFilterRail({
	search,
	facets,
	onChange,
	onClear,
}: ConsultantFilterRailProps) {
	const navigationQuery = useMarketplaceCategoryNavigationQuery();
	const categories = navigationQuery.data ?? [];
	const activeCategory = categories.find(
		(entry) => entry.slug === search.category,
	);
	const activeCount = countActiveFilters(search);

	const categoryOptions = useMemo<Option[]>(
		() => [
			{ value: undefined, label: "All categories" },
			...categories.map((entry) => ({
				value: entry.slug,
				label: entry.name,
				count: facets?.categories.find((facet) => facet.slug === entry.slug)
					?.count,
			})),
		],
		[categories, facets],
	);

	const specialityOptions = useMemo<Option[]>(() => {
		if (!activeCategory) return [];
		return [
			{ value: undefined, label: "Everything in this category" },
			...activeCategory.subcategories.map((entry) => ({
				value: entry.slug,
				label: entry.name,
				count: facets?.subcategories.find(
					(facet) =>
						facet.categorySlug === activeCategory.slug &&
						facet.slug === entry.slug,
				)?.count,
			})),
		];
	}, [activeCategory, facets]);

	return (
		<div className="space-y-4">
			{/*
			 * The reference's "Pro catalog / Full catalog" pair. Here the split is
			 * between everybody verified and the consultants who have actually
			 * published a priced catalog — the only version of that distinction the
			 * data supports.
			 */}
			<div className="flex rounded-full border border-border bg-card p-1">
				<SegmentButton
					label="All consultants"
					active={!search.catalog}
					onClick={() => onChange({ catalog: undefined })}
				/>
				<SegmentButton
					label="With a catalog"
					active={Boolean(search.catalog)}
					onClick={() => onChange({ catalog: true })}
				/>
			</div>

			<div className="flex items-center justify-between px-0.5">
				<h2 className="text-[13px] font-semibold text-foreground">Filters</h2>
				{activeCount > 0 && (
					<button
						type="button"
						onClick={onClear}
						className="text-[12px] font-medium text-primary hover:underline"
					>
						Clear all
					</button>
				)}
			</div>

			<div className="rounded-xl border border-border bg-card">
				<FilterSection label="Category" defaultOpen>
					<OptionList
						options={categoryOptions}
						selected={search.category}
						onSelect={(value) =>
							onChange({ category: value, subcategory: undefined })
						}
					/>
				</FilterSection>

				{/*
				 * Specialities only appear once a category is chosen: sub-category
				 * slugs are unique per category, not globally, so an ungrouped list
				 * of eighty-four could not be resolved to a single filter.
				 */}
				{activeCategory && specialityOptions.length > 1 && (
					<FilterSection
						label={`${activeCategory.name} specialities`}
						defaultOpen
					>
						<OptionList
							options={specialityOptions}
							selected={search.subcategory}
							onSelect={(value) => onChange({ subcategory: value })}
						/>
					</FilterSection>
				)}

				<SectionLabel>Service options</SectionLabel>

				<FilterSection label="Budget">
					<OptionList
						options={[
							{ value: undefined, label: "Any budget" },
							...BUDGET_BRACKETS.map((bracket) => ({
								value: bracket.key,
								label: bracket.label,
							})),
						]}
						selected={search.budget}
						onSelect={(value) => onChange({ budget: value })}
					/>
					{facets?.priceRange && (
						<p className="mt-2.5 text-[11.5px] text-muted-foreground">
							Published services run {formatMoney(facets.priceRange.min)}–
							{formatMoney(facets.priceRange.max)}.
						</p>
					)}
				</FilterSection>

				<FilterSection label="Delivery time">
					<OptionList
						options={[
							{ value: undefined, label: "Any timeline" },
							...DELIVERY_OPTIONS.map((option) => ({
								value: String(option.value),
								label: option.label,
							})),
						]}
						selected={search.delivery ? String(search.delivery) : undefined}
						onSelect={(value) =>
							onChange({ delivery: value ? Number(value) : undefined })
						}
					/>
				</FilterSection>

				<ToggleRow
					label="Offers hourly rates"
					checked={Boolean(search.hourly)}
					onChange={(checked) =>
						onChange({
							hourly: checked || undefined,
							hourlyMin: undefined,
							hourlyMax: undefined,
						})
					}
				/>

				{search.hourly && (
					<div className="flex items-center gap-2 px-4 pb-4">
						<RangeInput
							label="Min hourly"
							value={search.hourlyMin}
							onCommit={(value) => onChange({ hourlyMin: value })}
						/>
						<span className="text-[12px] text-muted-foreground">–</span>
						<RangeInput
							label="Max hourly"
							value={search.hourlyMax}
							onCommit={(value) => onChange({ hourlyMax: value })}
						/>
					</div>
				)}

				<SectionLabel>Consultant details</SectionLabel>

				<FilterSection label="Consultant speaks">
					{facets?.languages.length ? (
						<OptionList
							options={[
								{ value: undefined, label: "Any language" },
								...facets.languages.map((language) => ({
									value: language.code,
									label: language.name,
									count: language.count,
								})),
							]}
							selected={search.language}
							onSelect={(value) => onChange({ language: value })}
						/>
					) : (
						<EmptyFacet label="No languages recorded yet" />
					)}
				</FilterSection>

				<FilterSection label="Consultant lives in">
					{facets?.countries.length ? (
						<OptionList
							options={[
								{ value: undefined, label: "Anywhere" },
								...facets.countries.map((country) => ({
									value: country.value,
									label: country.value,
									count: country.count,
								})),
							]}
							selected={search.country}
							onSelect={(value) => onChange({ country: value })}
						/>
					) : (
						<EmptyFacet label="No locations recorded yet" />
					)}
				</FilterSection>

				<ToggleRow
					label="Available now"
					checked={Boolean(search.available)}
					onChange={(checked) => onChange({ available: checked || undefined })}
				/>
			</div>

			<VettedGuarantee />
		</div>
	);
}

function SegmentButton({
	label,
	active,
	onClick,
}: {
	label: string;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={`flex-1 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
				active
					? "bg-foreground text-background"
					: "text-muted-foreground hover:text-foreground"
			}`}
		>
			{label}
		</button>
	);
}

/**
 * The counterpart to the reference's "Vetted Pro guarantee" panel. Every line
 * is something the platform actually enforces — verification gates who can take
 * work, signing activates the engagement, and deliverables are accepted against
 * criteria. No money-back promise, because there is no such policy.
 */
function VettedGuarantee() {
	const points = [
		"Reviewed and verified before taking work",
		"Scope, rates and dates agreed in a signed contract",
		"Deliverables accepted against criteria",
		"One accountable lead for the whole delivery",
	];

	return (
		<div className="rounded-xl border border-border bg-card p-4">
			<h3 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
				<ShieldCheck className="h-4 w-4 text-primary" />
				What vetted means here
			</h3>
			<ul className="mt-3 space-y-2.5">
				{points.map((point) => (
					<li
						key={point}
						className="flex items-start gap-2 text-[12.5px] leading-snug text-muted-foreground"
					>
						<Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
						{point}
					</li>
				))}
			</ul>
		</div>
	);
}

function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<p className="border-t border-border px-4 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
			{children}
		</p>
	);
}

function FilterSection({
	label,
	defaultOpen = false,
	children,
}: {
	label: string;
	defaultOpen?: boolean;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);
	const panelId = useId();

	return (
		<div className="border-t border-border first:border-t-0">
			<button
				type="button"
				onClick={() => setOpen((current) => !current)}
				aria-expanded={open}
				aria-controls={panelId}
				className="flex w-full items-center justify-between px-4 py-3.5 text-left text-[13.5px] font-semibold text-foreground"
			>
				{label}
				<ChevronDown
					className={`h-4 w-4 text-muted-foreground transition-transform ${
						open ? "rotate-180" : ""
					}`}
				/>
			</button>
			{open && (
				<div id={panelId} className="px-4 pb-4">
					{children}
				</div>
			)}
		</div>
	);
}

/**
 * A radio group drawn as a list, collapsed to `COLLAPSED_ROWS` until asked to
 * grow. Radios rather than checkboxes because each of these filters is a single
 * value on the API — offering multi-select here would promise an OR the
 * endpoint does not implement.
 */
function OptionList({
	options,
	selected,
	onSelect,
}: {
	options: Option[];
	selected: string | undefined;
	onSelect: (value: string | undefined) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const hidden = options.length - COLLAPSED_ROWS;

	// A chosen option always stays on screen, even when it sits past the fold:
	// collapsing the list must never hide what the results are filtered by.
	const selectedIndex = options.findIndex(
		(option) => (option.value ?? undefined) === (selected ?? undefined),
	);
	const visible =
		expanded || hidden <= 0
			? options
			: [
					...options.slice(0, COLLAPSED_ROWS),
					...(selectedIndex >= COLLAPSED_ROWS ? [options[selectedIndex]] : []),
				];

	return (
		<div>
			<ul className="space-y-0.5">
				{visible.map((option) => {
					const active =
						(option.value ?? undefined) === (selected ?? undefined);
					return (
						<li key={option.value ?? "any"}>
							<button
								type="button"
								onClick={() => onSelect(option.value)}
								aria-pressed={active}
								className="flex w-full items-start gap-2.5 rounded-lg py-1.5 pr-1 text-left text-[13px] transition-colors hover:text-foreground"
							>
								<span
									className={`mt-0.5 flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
										active ? "border-foreground" : "border-muted-foreground/40"
									}`}
								>
									{active && (
										<span className="h-[7px] w-[7px] rounded-full bg-foreground" />
									)}
								</span>
								<span
									className={
										active
											? "font-medium text-foreground"
											: "text-foreground/80"
									}
								>
									{option.label}
									{option.count !== undefined && (
										<span className="ml-1 text-muted-foreground">
											({option.count})
										</span>
									)}
								</span>
							</button>
						</li>
					);
				})}
			</ul>

			{hidden > 0 && (
				<button
					type="button"
					onClick={() => setExpanded((current) => !current)}
					className="mt-1.5 text-[12.5px] font-medium text-foreground underline underline-offset-2 hover:text-primary"
				>
					{expanded ? "Show less" : `+${hidden} more`}
				</button>
			)}
		</div>
	);
}

function ToggleRow({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<div className="flex items-center justify-between border-t border-border px-4 py-3.5">
			<span className="text-[13.5px] font-semibold text-foreground">
				{label}
			</span>
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				aria-label={label}
				onClick={() => onChange(!checked)}
				className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
					checked ? "bg-primary" : "bg-muted-foreground/30"
				}`}
			>
				<span
					className={`absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform ${
						checked ? "translate-x-4" : "translate-x-0.5"
					}`}
				/>
			</button>
		</div>
	);
}

/**
 * Committed on blur rather than per keystroke: each change rewrites the URL and
 * refetches, and typing "1200" should be one request, not four.
 */
function RangeInput({
	label,
	value,
	onCommit,
}: {
	label: string;
	value: number | undefined;
	onCommit: (value: number | undefined) => void;
}) {
	const [draft, setDraft] = useState(value === undefined ? "" : String(value));

	return (
		<label className="flex-1">
			<span className="sr-only">{label}</span>
			<input
				type="number"
				min={0}
				inputMode="numeric"
				placeholder={label}
				value={draft}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={() => {
					const parsed = Number(draft);
					onCommit(
						draft.trim() === "" || !Number.isFinite(parsed) || parsed < 0
							? undefined
							: parsed,
					);
				}}
				className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[12.5px] text-foreground outline-none focus:border-primary"
			/>
		</label>
	);
}

function EmptyFacet({ label }: { label: string }) {
	return <p className="text-[12px] text-muted-foreground">{label}</p>;
}

function formatMoney(amount: number): string {
	return `$${Math.round(amount).toLocaleString()}`;
}
