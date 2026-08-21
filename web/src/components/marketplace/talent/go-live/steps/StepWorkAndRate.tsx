import { ExternalLink, Plus, X } from "lucide-react";
import { useState } from "react";
import type { AvailabilityStatus } from "@/services/profile.service";
import { GoLiveChoiceCard, GoLiveField, GoLiveInput } from "../GoLiveForm";
import type { DraftAction, ProfileDraft } from "../profileDraft";

/**
 * Step 3: what you have made, and what you charge.
 *
 * The two belong together — both are the commercial half of the listing, and
 * keeping them on one step is what holds the wizard to five.
 *
 * At least one link is required. The server will not publish a profile with no
 * `user_portfolios` row, so an optional field here would let someone finish the
 * wizard and still be refused. The copy says the links are public, because
 * they are: portfolios render on the profile page.
 */
export function StepWorkAndRate({
	draft,
	dispatch,
}: {
	draft: ProfileDraft;
	dispatch: React.Dispatch<DraftAction>;
}) {
	const [pending, setPending] = useState("");
	const [error, setError] = useState<string | null>(null);
	const set = (patch: Partial<ProfileDraft>) =>
		dispatch({ type: "set", patch });

	const addLink = () => {
		const raw = pending.trim();
		if (!raw) return;
		// The API validates with @IsUrl(), which rejects a bare domain — so
		// normalise here rather than letting the save fail three steps later.
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
		set({ links: [...draft.links, url] });
		setPending("");
	};

	return (
		<div className="space-y-5">
			<section className="rounded-2xl border border-border bg-card p-5">
				<h3 className="text-[15px] font-semibold text-foreground">
					Show your work
				</h3>
				<p className="mt-1 mb-4 text-sm text-muted-foreground">
					A site, a repo, a case study — anything a client can look at. These
					appear on your public profile, and you need at least one to go live.
				</p>

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
						placeholder="mypersonalwebsite.com"
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
										set({ links: draft.links.filter((l) => l !== link) })
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
			</section>

			<section className="space-y-5 rounded-2xl border border-border bg-card p-5">
				<div>
					<h3 className="text-[15px] font-semibold text-foreground">
						Your rate
					</h3>
					<p className="mt-1 text-sm text-muted-foreground">
						You can change this whenever you like.
					</p>
				</div>

				<GoLiveField label="Availability" required>
					<div className="grid gap-3 sm:grid-cols-2">
						{(
							[
								["available", "Available", "Ready for new projects"],
								[
									"partially_available",
									"Partially available",
									"Open to part-time work",
								],
								["unavailable", "Unavailable", "Not looking right now"],
							] as [AvailabilityStatus, string, string][]
						).map(([value, label, description]) => (
							<GoLiveChoiceCard
								key={value}
								name="availability"
								value={value}
								label={label}
								description={description}
								checked={draft.availability === value}
								onChange={() => set({ availability: value })}
							/>
						))}
					</div>
				</GoLiveField>

				<div className="grid gap-5 sm:grid-cols-3">
					<GoLiveField label="Hourly rate" required htmlFor="gl-rate">
						<GoLiveInput
							id="gl-rate"
							type="number"
							min={0}
							prefix="$"
							value={draft.hourlyRate}
							onChange={(event) => set({ hourlyRate: event.target.value })}
						/>
					</GoLiveField>
					<GoLiveField label="Currency" required htmlFor="gl-currency">
						<GoLiveInput
							id="gl-currency"
							value={draft.currency}
							maxLength={3}
							onChange={(event) =>
								set({ currency: event.target.value.toUpperCase() })
							}
						/>
					</GoLiveField>
					<GoLiveField label="Hours a week" required htmlFor="gl-hours">
						<GoLiveInput
							id="gl-hours"
							type="number"
							min={1}
							value={draft.weeklyHours}
							onChange={(event) => set({ weeklyHours: event.target.value })}
						/>
					</GoLiveField>
				</div>
			</section>
		</div>
	);
}
