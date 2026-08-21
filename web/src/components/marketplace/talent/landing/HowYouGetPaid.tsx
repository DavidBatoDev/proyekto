import {
	FileSignature,
	HandCoins,
	ListChecks,
	ReceiptText,
} from "lucide-react";

/**
 * The money question, answered with the four records that actually exist:
 * `contracts`, `project_deliverables`, `invoices`, `payouts`.
 *
 * No rates, no fee percentage, no payout timeline. Those are commercial terms
 * this page is not the authority on, and a number invented here would be the
 * one thing a reader remembers.
 */
const STEPS = [
	{
		icon: FileSignature,
		title: "Terms get signed",
		body: "Rates, dates and scope live in a contract. Both sides sign it, and amendments take effect going forward — never retroactively.",
	},
	{
		icon: ListChecks,
		title: "Work gets accepted",
		body: "Deliverables carry acceptance criteria and evidence. Acceptance is explicit, so 'done' is a state rather than an opinion.",
	},
	{
		icon: ReceiptText,
		title: "An invoice is raised",
		body: "Invoice lines are built from the contract you already signed, so the amount is not a fresh negotiation.",
	},
	{
		icon: HandCoins,
		title: "You get paid out",
		body: "Payouts are recorded against the engagement, leaving a history that survives long after the project closes.",
	},
];

export function HowYouGetPaid() {
	return (
		<section className="mt-20 border-y border-border bg-muted/40 lg:mt-24">
			<div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-10 lg:py-20">
				<h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
					How getting paid works
				</h2>
				<p className="mt-3 max-w-2xl text-[15px] text-muted-foreground">
					Four steps, each one a record you can point at if anything is
					disputed.
				</p>

				<ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{STEPS.map((step, index) => (
						<li
							key={step.title}
							className="rounded-2xl border border-border bg-card p-5"
						>
							<div className="flex items-center gap-3">
								<span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
									<step.icon className="h-4.5 w-4.5" />
								</span>
								<span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
									Step {index + 1}
								</span>
							</div>
							<h3 className="mt-4 text-[17px] font-semibold text-foreground">
								{step.title}
							</h3>
							<p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
								{step.body}
							</p>
						</li>
					))}
				</ol>
			</div>
		</section>
	);
}
