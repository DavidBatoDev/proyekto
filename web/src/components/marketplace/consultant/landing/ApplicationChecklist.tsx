import { useQuery } from "@tanstack/react-query";
import {
	BadgeCheck,
	Check,
	ExternalLink,
	ShieldCheck,
	UserRound,
	X,
} from "lucide-react";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { isActiveConsultant } from "@/lib/auth-utils";
import {
	applicationService,
	type ConsultantRequirement,
} from "@/services/profile.service";
import { useAuthStore } from "@/stores/authStore";

/**
 * What the server actually checks before an application can be submitted,
 * taken from ConsultantEligibilityService (backend
 * modules/marketplace/applications). Keep the `keys` in step with that
 * service's `ConsultantRequirement` enum — the fourth card deliberately
 * carries two of the five values, because "links and a rate" is one idea to a
 * reader even though it is two checks to the server.
 *
 * Anonymous readers get the static cards. A signed-in, not-yet-verified
 * reader gets live tick/cross marks from the same eligibility endpoint the
 * apply wizard's review step uses — the checklist becomes their checklist.
 */
const REQUIREMENTS: {
	icon: React.ElementType;
	title: string;
	body: string;
	keys: ConsultantRequirement[];
}[] = [
	{
		icon: ShieldCheck,
		title: "A verified identity",
		body: "One government-issued photo ID, stored privately and checked by the review team. It is what makes 'vetted' mean something to clients.",
		keys: ["identity_document"],
	},
	{
		icon: UserRound,
		title: "A complete professional profile",
		body: "A clear headline, a real bio, and the work history behind them — imported from LinkedIn or a CV, or typed in.",
		keys: ["profile_basics"],
	},
	{
		icon: BadgeCheck,
		title: "Expertise we can place",
		body: "Pick the specialities you want to lead from the live marketplace taxonomy, with your years in each. Approval lists you in the directory under exactly those.",
		keys: ["expertise_placement"],
	},
	{
		icon: ExternalLink,
		title: "Work a reviewer can open",
		body: "Your LinkedIn plus at least one link that shows real delivery — a case study, a site you shipped, a repo — and the rate you charge.",
		keys: ["work_links", "rate_settings"],
	},
];

export function ApplicationChecklist() {
	const { isAuthenticated } = useAuthStore();
	const { data: profile } = useProfileQuery();
	const verified = isActiveConsultant(profile);

	// Live marks only for someone the checklist is actionable for. A verified
	// consultant's marks would all read "missing" (they never filed the new
	// application) and an anonymous reader has nothing to check.
	const personalized = isAuthenticated && !verified;
	const eligibility = useQuery({
		queryKey: ["consultant-application", "eligibility"],
		queryFn: () => applicationService.getEligibility(),
		enabled: personalized,
		staleTime: 60 * 1000,
	});
	const missing = new Set(eligibility.data?.missing ?? []);
	const showMarks = personalized && eligibility.isSuccess;

	return (
		<section className="mx-auto max-w-7xl px-4 pt-20 sm:px-6 lg:px-10 lg:pt-24">
			<div className="grid gap-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
				<div>
					<h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
						What we look for
					</h2>
					<p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
						Every application is reviewed by a human before anything is
						approved. Everything below is checked by the server before you can
						even submit — no surprises on the last step.
					</p>
					{showMarks && (
						<p className="mt-3 text-[13px] leading-relaxed text-muted-foreground/80">
							The marks are live: they reflect what your account already has.
						</p>
					)}
				</div>

				<ul className="divide-y divide-border rounded-2xl border border-border bg-card">
					{REQUIREMENTS.map((requirement) => {
						const met =
							showMarks && requirement.keys.every((key) => !missing.has(key));
						return (
							<li key={requirement.title} className="flex gap-4 p-5">
								<span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
									<requirement.icon className="h-4.5 w-4.5" />
								</span>
								<div className="min-w-0 flex-1">
									<h3 className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
										{requirement.title}
										{showMarks && (
											<span
												className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${
													met
														? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
														: "bg-muted text-muted-foreground"
												}`}
												title={met ? "You have this" : "Still needed"}
											>
												{met ? (
													<Check className="h-3 w-3" />
												) : (
													<X className="h-3 w-3" />
												)}
											</span>
										)}
									</h3>
									<p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
										{requirement.body}
									</p>
								</div>
							</li>
						);
					})}
				</ul>
			</div>
		</section>
	);
}
