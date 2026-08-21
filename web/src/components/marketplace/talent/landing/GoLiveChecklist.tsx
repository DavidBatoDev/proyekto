import { Link } from "@tanstack/react-router";
import { BadgeCheck, Briefcase, Wallet } from "lucide-react";
import { useUser } from "@/stores/authStore";

/**
 * What the server actually checks before it will flip
 * `talent_profiles.status` to `active`, taken from
 * `backend/src/modules/marketplace/profile/talent-eligibility.service.ts`.
 *
 * Keep this list in step with that service. It used to carry a fourth entry --
 * a verified identity document -- which was dropped as a requirement: the
 * `is_verified` flag is admin-set, and in practice no profile ever received it,
 * so the gate blocked everyone rather than raising the bar. Uploading an ID is
 * still possible from the profile page; it just no longer decides anything.
 */
const REQUIREMENTS = [
	{
		key: "basics",
		icon: Briefcase,
		title: "A profile that reads like a professional",
		body: "A headline, a bio and your country.",
		note: "Set on your profile, not in the go-live wizard — worth doing first.",
	},
	{
		key: "rate",
		icon: Wallet,
		title: "A rate card",
		body: "Your hourly rate, its currency, and how available you are.",
		note: "Collected in the wizard. Change it whenever you like.",
	},
	{
		key: "portfolio",
		icon: BadgeCheck,
		title: "At least one piece of work",
		body: "One portfolio item is the minimum; your best one is the one to lead with.",
		note: "Collected in the wizard.",
	},
] as const;

export function GoLiveChecklist() {
	// The profile editor lives at /profile/$profileId, so the shortcut only
	// exists for someone signed in. An anonymous reader gets the sentence
	// without a link rather than a link that cannot resolve.
	const user = useUser();

	return (
		<section className="mx-auto max-w-7xl px-4 pt-20 sm:px-6 lg:px-10 lg:pt-24">
			<div className="grid gap-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
				<div>
					<h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
						What you need to go live
					</h2>
					<p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
						Everything below is checked by the server before your profile
						becomes discoverable. Nothing here is a surprise fee or a
						subscription -- it is the evidence a client needs to hire a
						stranger.
					</p>
				</div>

				<ul className="divide-y divide-border rounded-2xl border border-border bg-card">
					{REQUIREMENTS.map((requirement) => (
						<li key={requirement.key} className="flex gap-4 p-5">
							<span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
								<requirement.icon className="h-4.5 w-4.5" />
							</span>
							<div className="min-w-0">
								<h3 className="text-[15px] font-semibold text-foreground">
									{requirement.title}
								</h3>
								<p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
									{requirement.body}
								</p>
								<p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground/80">
									{requirement.note}
									{requirement.key === "basics" && user?.id && (
										<>
											{" "}
											<Link
												to="/profile/$profileId"
												params={{ profileId: user.id }}
												className="font-medium text-primary hover:underline"
											>
												Open your profile
											</Link>
										</>
									)}
								</p>
							</div>
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}
