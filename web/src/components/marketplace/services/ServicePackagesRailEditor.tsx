import {
	ArrowLeft,
	ArrowRight,
	Check,
	Clock,
	Plus,
	RefreshCw,
	Trash2,
	X,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export interface PackageDraft {
	/** Stable local key — package ids change on every replace-set save. */
	key: string;
	title: string;
	description: string;
	price: string;
	deliveryDays: string;
	/** Empty string = unlimited revisions. */
	revisions: string;
	features: string[];
}

export const MAX_PACKAGES = 10;
const MAX_FEATURES = 12;

let keyCounter = 0;
export function emptyPackageDraft(): PackageDraft {
	keyCounter += 1;
	return {
		key: `pkg-${keyCounter}`,
		title: "",
		description: "",
		price: "",
		deliveryDays: "",
		revisions: "",
		features: [],
	};
}

const inline =
	"rounded-md bg-transparent outline-none transition-colors placeholder:text-muted-foreground/60 hover:bg-muted/60 focus:bg-muted/60";

/**
 * The WYSIWYG tier rail: the exact card buyers see — tier tabs across the
 * top, then price, delivery, revisions and inclusions — with every value
 * editable in place. Tabs carry the seller's own titles (as many tiers as
 * they want, capped server-side at 10); the "+" tab adds one, and the
 * footer of the open tier moves or removes it.
 */
export function ServicePackagesRailEditor({
	packages,
	currency,
	onChange,
}: {
	packages: PackageDraft[];
	currency: string;
	onChange: (packages: PackageDraft[]) => void;
}) {
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const [pendingFeature, setPendingFeature] = useState("");
	const selected =
		packages.find((pkg) => pkg.key === selectedKey) ?? packages[0] ?? null;

	const patch = (key: string, partial: Partial<PackageDraft>) =>
		onChange(
			packages.map((pkg) => (pkg.key === key ? { ...pkg, ...partial } : pkg)),
		);

	const add = () => {
		const draft = emptyPackageDraft();
		onChange([...packages, draft]);
		setSelectedKey(draft.key);
	};

	const move = (key: string, delta: number) => {
		const index = packages.findIndex((pkg) => pkg.key === key);
		const target = index + delta;
		if (index < 0 || target < 0 || target >= packages.length) return;
		const next = [...packages];
		[next[index], next[target]] = [next[target], next[index]];
		onChange(next);
	};

	if (!selected) {
		return (
			<div className="rounded-2xl border border-border bg-card p-5 text-center">
				<p className="text-sm text-muted-foreground">
					Buyers pick a tier here. Add your first — name it whatever fits.
				</p>
				<button
					type="button"
					onClick={add}
					className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
				>
					<Plus className="h-4 w-4" />
					Add a tier
				</button>
			</div>
		);
	}

	const index = packages.findIndex((pkg) => pkg.key === selected.key);

	const addFeature = () => {
		const value = pendingFeature.trim();
		setPendingFeature("");
		if (
			!value ||
			selected.features.includes(value) ||
			selected.features.length >= MAX_FEATURES
		)
			return;
		patch(selected.key, { features: [...selected.features, value] });
	};

	return (
		<div className="overflow-hidden rounded-2xl border border-border bg-card">
			<div className="flex overflow-x-auto border-b border-border hide-scrollbar">
				{packages.map((pkg) => (
					<button
						key={pkg.key}
						type="button"
						onClick={() => setSelectedKey(pkg.key)}
						aria-pressed={pkg.key === selected.key}
						className={cn(
							"min-w-0 flex-1 cursor-pointer whitespace-nowrap border-b-2 px-4 py-3 text-[13px] font-semibold transition-colors",
							pkg.key === selected.key
								? "border-primary text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						{pkg.title.trim() || "Untitled"}
					</button>
				))}
				{packages.length < MAX_PACKAGES && (
					<button
						type="button"
						onClick={add}
						aria-label="Add a tier"
						className="shrink-0 cursor-pointer border-b-2 border-transparent px-3 py-3 text-muted-foreground transition-colors hover:text-foreground"
					>
						<Plus className="h-4 w-4" />
					</button>
				)}
			</div>

			<div className="space-y-4 p-5">
				<div className="flex items-baseline justify-between gap-3">
					<input
						value={selected.title}
						maxLength={80}
						onChange={(event) =>
							patch(selected.key, { title: event.target.value })
						}
						placeholder="Tier name"
						aria-label="Tier name"
						className={cn(
							inline,
							"-mx-1.5 min-w-0 flex-1 px-1.5 py-0.5 text-[15px] font-semibold text-foreground",
						)}
					/>
					<span className="flex shrink-0 items-baseline gap-1 text-2xl font-semibold tracking-tight text-foreground">
						<span className="text-sm font-medium text-muted-foreground">
							{currency}
						</span>
						<input
							value={selected.price}
							inputMode="decimal"
							onChange={(event) =>
								patch(selected.key, { price: event.target.value })
							}
							placeholder="0"
							aria-label="Price"
							className={cn(inline, "w-24 px-1.5 py-0.5 text-right")}
						/>
					</span>
				</div>

				<textarea
					value={selected.description}
					rows={2}
					maxLength={600}
					onChange={(event) =>
						patch(selected.key, { description: event.target.value })
					}
					placeholder="Scope in one or two sentences — what this tier delivers."
					aria-label="Tier description"
					className={cn(
						inline,
						"-mx-1.5 block w-[calc(100%+0.75rem)] resize-none px-1.5 py-0.5 text-[13px] leading-relaxed text-muted-foreground",
					)}
				/>

				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
					<span className="inline-flex items-center gap-1.5">
						<Clock className="h-3.5 w-3.5" />
						<input
							value={selected.deliveryDays}
							inputMode="numeric"
							onChange={(event) =>
								patch(selected.key, { deliveryDays: event.target.value })
							}
							placeholder="–"
							aria-label="Delivery days"
							className={cn(inline, "w-8 px-1 py-0.5 text-center")}
						/>
						-day delivery
					</span>
					<span className="inline-flex items-center gap-1.5">
						<RefreshCw className="h-3.5 w-3.5" />
						<input
							value={selected.revisions}
							inputMode="numeric"
							onChange={(event) =>
								patch(selected.key, { revisions: event.target.value })
							}
							placeholder="∞"
							aria-label="Revisions (blank means unlimited)"
							title="Leave blank for unlimited revisions"
							className={cn(inline, "w-8 px-1 py-0.5 text-center")}
						/>
						revisions
					</span>
				</div>

				<ul className="space-y-1.5">
					{selected.features.map((feature, featureIndex) => (
						<li
							key={feature}
							className="group/feature flex items-start gap-2 text-[13px] text-foreground"
						>
							<Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
							<span className="min-w-0 flex-1">{feature}</span>
							<button
								type="button"
								onClick={() =>
									patch(selected.key, {
										features: selected.features.filter(
											(_, i) => i !== featureIndex,
										),
									})
								}
								aria-label={`Remove ${feature}`}
								className="cursor-pointer text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/feature:opacity-100"
							>
								<X className="h-3.5 w-3.5" />
							</button>
						</li>
					))}
					{selected.features.length < MAX_FEATURES && (
						<li className="flex items-center gap-2 text-[13px]">
							<Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<input
								value={pendingFeature}
								maxLength={120}
								onChange={(event) => setPendingFeature(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										addFeature();
									}
								}}
								onBlur={addFeature}
								placeholder="Add what's included — press Enter"
								aria-label="Add an inclusion"
								className={cn(
									inline,
									"-mx-1.5 min-w-0 flex-1 px-1.5 py-0.5 text-foreground",
								)}
							/>
						</li>
					)}
				</ul>

				<div>
					<div
						aria-hidden
						className="rounded-xl bg-primary/50 py-2.5 text-center text-sm font-semibold text-primary-foreground"
					>
						Contact seller
					</div>
					<p className="mt-1.5 text-center text-[11px] text-muted-foreground">
						Buyers message you from here with this tier attached.
					</p>
				</div>

				<div className="flex items-center justify-between border-t border-border pt-3">
					<span className="flex items-center gap-1">
						<button
							type="button"
							onClick={() => move(selected.key, -1)}
							disabled={index === 0}
							aria-label="Move tier left"
							className="cursor-pointer rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
						>
							<ArrowLeft className="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							onClick={() => move(selected.key, 1)}
							disabled={index === packages.length - 1}
							aria-label="Move tier right"
							className="cursor-pointer rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
						>
							<ArrowRight className="h-3.5 w-3.5" />
						</button>
					</span>
					<button
						type="button"
						onClick={() => {
							setSelectedKey(null);
							onChange(packages.filter((pkg) => pkg.key !== selected.key));
						}}
						className="inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
					>
						<Trash2 className="h-3.5 w-3.5" />
						Remove tier
					</button>
				</div>
			</div>
		</div>
	);
}
