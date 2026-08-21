import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import {
	profileService,
	type TalentRequirement,
} from "@/services/profile.service";
import { GoLiveCallout, GoLivePanel } from "../GoLiveForm";
import type { ProfileDraft } from "../profileDraft";

/**
 * What each server-side requirement means in plain words.
 *
 * The API returns raw enum values (`profile_basics`, `rate_settings`), which
 * the old wizard pasted straight at the user as
 * "Complete these requirements before going live: rate_settings, profile_basics".
 */
const REQUIREMENTS: {
	key: TalentRequirement;
	label: string;
	detail: string;
}[] = [
	{
		key: "profile_basics",
		label: "Headline, bio and country",
		detail: "Collected in step 2.",
	},
	{
		key: "rate_settings",
		label: "Rate and availability",
		detail: "Collected in step 3.",
	},
	{
		key: "portfolio",
		label: "At least one piece of work",
		detail: "The links you added in step 3.",
	},
];

const Row = ({ label, value }: { label: string; value: string | number }) => (
	<div className="flex gap-3 border-b border-border py-1.5 text-sm last:border-0">
		<span className="w-36 shrink-0 text-muted-foreground">{label}</span>
		<span className="min-w-0 flex-1 truncate pl-2 font-medium text-foreground">
			{value || "—"}
		</span>
	</div>
);

/**
 * Step 4: what you entered, and whether it is actually enough.
 *
 * The checklist asks the server rather than deriving itself from the draft: the
 * draft is what the user typed, not what was stored, and only the server can
 * say whether a write actually landed.
 */
export function StepReview({
	draft,
	enabled,
}: {
	draft: ProfileDraft;
	enabled: boolean;
}) {
	const eligibility = useQuery({
		queryKey: ["talent", "eligibility"],
		queryFn: () => profileService.getGoLiveEligibility(),
		enabled,
		// Nothing left in the checklist can change without the user acting, so
		// the default cache is fine. It used to force a refetch on every mount
		// because an admin could approve an identity document mid-session.
		refetchOnMount: true,
	});

	const missing = new Set(eligibility.data?.missing ?? []);

	return (
		<div className="space-y-6">
			<div>
				<p className="mb-3 text-sm font-semibold text-foreground">
					What you need to go live
				</p>
				<GoLivePanel className="divide-y divide-border p-0">
					{eligibility.isLoading ? (
						<div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
							<Loader2 className="h-4 w-4 animate-spin" /> Checking your
							profile…
						</div>
					) : (
						REQUIREMENTS.map((requirement) => {
							const met = !missing.has(requirement.key);
							return (
								<div
									key={requirement.key}
									className="flex items-start gap-3 p-4"
								>
									<span
										className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
											met
												? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
												: "bg-muted text-muted-foreground"
										}`}
									>
										{met ? (
											<Check className="h-3 w-3" />
										) : (
											<X className="h-3 w-3" />
										)}
									</span>
									<span className="min-w-0">
										<span className="block text-sm font-medium text-foreground">
											{requirement.label}
										</span>
										<span className="block text-xs text-muted-foreground">
											{requirement.detail}
										</span>
									</span>
								</div>
							);
						})
					)}
				</GoLivePanel>

				{eligibility.isError && (
					<div className="mt-3">
						<GoLiveCallout tone="caution">
							We could not check your profile just now. You can still try to go
							live — we will tell you if anything is missing.
						</GoLiveCallout>
					</div>
				)}
			</div>

			<div>
				<p className="mb-3 text-sm font-semibold text-foreground">
					Your listing
				</p>
				<GoLivePanel className="space-y-2 p-5">
					<Row label="Name" value={draft.display_name} />
					<Row label="Headline" value={draft.headline} />
					<Row
						label="Location"
						value={[draft.city, draft.country].filter(Boolean).join(", ")}
					/>
					<Row
						label="Availability"
						value={draft.availability.replace("_", " ")}
					/>
					<Row
						label="Rate"
						value={`$${draft.hourlyRate} ${draft.currency} · ${draft.weeklyHours} hrs/week`}
					/>
					<Row label="Skills" value={draft.skills.length} />
					<Row label="Work experience" value={draft.experiences.length} />
					<Row label="Links" value={draft.links.length} />
				</GoLivePanel>
				<p className="mt-4 text-xs leading-relaxed text-muted-foreground">
					Going live makes your profile visible to consultants hiring on
					Proyekto. You can pause it at any time from your profile.
				</p>
			</div>
		</div>
	);
}
