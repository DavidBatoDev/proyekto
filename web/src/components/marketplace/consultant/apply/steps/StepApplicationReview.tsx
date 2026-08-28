import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import {
	GoLiveCallout,
	GoLivePanel,
} from "@/components/marketplace/wizard/GoLiveForm";
import {
	applicationService,
	type ConsultantRequirement,
} from "@/services/profile.service";
import type { ConsultantApplyDraft } from "../applicationDraft";

/**
 * What each server-side requirement means in plain words. The API returns raw
 * enum values; pasting those at people is the exact failure the talent
 * wizard's review step was built to fix.
 */
const REQUIREMENTS: {
	key: ConsultantRequirement;
	label: string;
	detail: string;
}[] = [
	{
		key: "profile_basics",
		label: "Headline, bio and country",
		detail: "Collected in step 2.",
	},
	{
		key: "expertise_placement",
		label: "At least one speciality, each with years",
		detail:
			"Your marketplace placement from step 3, years of experience included.",
	},
	{
		key: "work_links",
		label: "LinkedIn and one work link",
		detail: "The links you added in step 3.",
	},
	{
		key: "rate_settings",
		label: "Rate and availability",
		detail: "Collected in step 3.",
	},
	{
		key: "identity_document",
		label: "An identity document",
		detail: "Uploaded in step 4.",
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
 * Step 5: what you entered, and whether it is actually enough.
 *
 * The checklist asks the server rather than deriving from the draft: the
 * draft is what was typed, not what was stored, and only the server can say
 * whether a write landed.
 */
export function StepApplicationReview({
	draft,
	enabled,
	isResubmission,
}: {
	draft: ConsultantApplyDraft;
	enabled: boolean;
	isResubmission: boolean;
}) {
	const eligibility = useQuery({
		queryKey: ["consultant-application", "eligibility"],
		queryFn: () => applicationService.getEligibility(),
		enabled,
		refetchOnMount: true,
	});

	const missing = new Set(eligibility.data?.missing ?? []);

	return (
		<div className="space-y-6">
			<div>
				<p className="mb-3 text-sm font-semibold text-foreground">
					What your application needs
				</p>
				<GoLivePanel className="divide-y divide-border p-0">
					{eligibility.isLoading ? (
						<div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
							<Loader2 className="h-4 w-4 animate-spin" /> Checking your
							application…
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
												? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
												: "bg-destructive/10 text-destructive"
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
			</div>

			<div>
				<p className="mb-3 text-sm font-semibold text-foreground">
					Your application at a glance
				</p>
				<GoLivePanel className="p-5">
					<Row label="Name" value={draft.display_name} />
					<Row label="Headline" value={draft.headline} />
					<Row
						label="Specialities"
						value={
							draft.placements.length
								? `${draft.placements.length} picked, with years`
								: ""
						}
					/>
					<Row label="LinkedIn" value={draft.linkedinUrl} />
					<Row
						label="Work links"
						value={draft.links.length ? `${draft.links.length} added` : ""}
					/>
					<Row
						label="Rate"
						value={
							Number.parseFloat(draft.hourlyRate)
								? `${draft.currency} ${draft.hourlyRate}/hr · ${draft.weeklyHours}h/week`
								: ""
						}
					/>
				</GoLivePanel>
			</div>

			<GoLiveCallout>
				{isResubmission
					? "Submitting sends your revised application back to the review team."
					: "Submitting sends your application to the review team. You will be notified here the moment there is a decision."}
			</GoLiveCallout>
		</div>
	);
}
