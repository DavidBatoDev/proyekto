import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { PLANS, type Plan } from "@/lib/pricing";
import { BillingToggle } from "./BillingToggle";

const SALES_EMAIL = "sales@proyekto.tech";

interface PricingCardsProps {
	yearly: boolean;
	onBillingChange: (yearly: boolean) => void;
}

function Price({ plan, yearly }: { plan: Plan; yearly: boolean }) {
	if (plan.priceYearly === null) {
		return (
			<p className="text-[1.75rem] font-semibold text-foreground">Custom</p>
		);
	}
	const amount = yearly ? plan.priceYearly : plan.priceMonthly;
	if (amount === 0) {
		return <p className="text-[1.75rem] font-semibold text-foreground">$0</p>;
	}
	return (
		<p className="text-[1.75rem] font-semibold text-foreground">
			${amount}
			<span className="ml-1.5 text-sm font-normal text-muted-foreground">
				per user/month
			</span>
		</p>
	);
}

function Cta({ plan }: { plan: Plan }) {
	const base =
		"flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold transition-colors";

	if (plan.cta.kind === "sales") {
		return (
			<a
				href={`mailto:${SALES_EMAIL}`}
				className={`${base} bg-secondary text-secondary-foreground hover:bg-secondary-dark`}
			>
				{plan.cta.label}
			</a>
		);
	}

	return (
		<Link
			to="/auth/signup"
			search={{ redirect: undefined }}
			className={
				plan.featured
					? `${base} bg-primary text-primary-foreground hover:bg-primary-dark`
					: `${base} border border-border text-foreground hover:bg-muted`
			}
		>
			{plan.cta.label}
		</Link>
	);
}

export function PricingCards({ yearly, onBillingChange }: PricingCardsProps) {
	return (
		<div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
			{PLANS.map((plan) => (
				<div key={plan.id} className="flex flex-col bg-background p-6 lg:p-7">
					<h2 className="text-lg font-semibold text-foreground">{plan.name}</h2>
					<div className="mt-2">
						<Price plan={plan} yearly={yearly} />
					</div>

					{/* The paid plans get the switch; Free and Enterprise get the
					    sentence that stands in for it, so all four columns keep the
					    same vertical rhythm. */}
					<div className="mt-5 flex h-6 items-center border-b border-border pb-8">
						{plan.priceYearly !== null && plan.priceYearly > 0 ? (
							<BillingToggle
								id={`billing-${plan.id}`}
								yearly={yearly}
								onChange={onBillingChange}
							/>
						) : (
							<span className="text-sm text-muted-foreground">
								{plan.tagline}
							</span>
						)}
					</div>

					<ul className="mt-7 flex-1 space-y-3">
						{plan.highlights.map((item) => (
							<li key={item} className="flex gap-2.5 text-sm text-foreground">
								<Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
								<span>{item}</span>
							</li>
						))}
					</ul>

					<div className="mt-8">
						<Cta plan={plan} />
					</div>
				</div>
			))}
		</div>
	);
}
