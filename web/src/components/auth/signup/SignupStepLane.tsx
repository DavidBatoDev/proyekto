import { ArrowRight, BriefcaseBusiness, Crown, UserRound } from "lucide-react";
import type { AccountRole } from "../../../lib/onboardingLane";

interface SignupStepLaneProps {
	lane: AccountRole;
	setLane: (lane: AccountRole) => void;
	onNext: () => void;
}

export function SignupStepLane({ lane, setLane, onNext }: SignupStepLaneProps) {
	return (
		<div className="flex flex-col gap-6">
			<div>
				<h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
					How will you use Proyekto?
				</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					Choose the account identity that best describes your work.
				</p>
			</div>

			<div className="grid gap-3 sm:grid-cols-3">
				<LaneCard
					label="I'm a client"
					description="Plan and fund projects with a vetted delivery lead."
					icon={BriefcaseBusiness}
					tone="primary"
					selected={lane === "client"}
					onClick={() => setLane("client")}
				/>
				<LaneCard
					label="I'm talent"
					description="Build your profile and contribute skills to project teams."
					icon={UserRound}
					tone="slate"
					selected={lane === "talent"}
					onClick={() => setLane("talent")}
				/>
				<LaneCard
					label="I'm a consultant"
					description="Apply to lead client engagements and vetted teams."
					icon={Crown}
					tone="amber"
					selected={lane === "consultant"}
					onClick={() => setLane("consultant")}
				/>
			</div>

			<button
				type="button"
				onClick={onNext}
				className="mt-2 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-md transition-colors hover:bg-primary/90"
			>
				Continue
				<ArrowRight className="h-4 w-4" />
			</button>

			<p className="text-center text-xs text-muted-foreground">
				Already have an account?{" "}
				<a
					href="/auth/login"
					className="font-semibold text-foreground underline decoration-border underline-offset-4 hover:text-primary hover:decoration-primary"
				>
					Log in
				</a>
			</p>
		</div>
	);
}

interface LaneCardProps {
	label: string;
	description: string;
	icon: typeof BriefcaseBusiness;
	tone: "primary" | "slate" | "amber";
	selected: boolean;
	onClick: () => void;
}

export function LaneCard({
	label,
	description,
	icon: Icon,
	tone,
	selected,
	onClick,
}: LaneCardProps) {
	const accent =
		tone === "amber"
			? "border-accent bg-accent text-accent-foreground"
			: tone === "slate"
				? "border-border bg-muted text-foreground"
				: "border-primary/20 bg-primary/10 text-primary";
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={selected}
			className={`group relative flex flex-col items-start gap-3 rounded-2xl border p-5 text-left transition-all ${
				selected
					? "border-primary bg-card shadow-md"
					: "border-border bg-card hover:border-primary/50 hover:shadow-sm"
			}`}
		>
			<span
				className={`absolute right-4 top-4 inline-flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors ${
					selected ? "border-primary bg-primary" : "border-border bg-card"
				}`}
			>
				{selected && (
					<span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
				)}
			</span>
			<span
				className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border ${accent}`}
			>
				<Icon className="h-5 w-5" />
			</span>
			<div className="pr-8">
				<h3 className="text-base font-semibold text-foreground">{label}</h3>
				<p className="mt-1 text-sm leading-relaxed text-muted-foreground">
					{description}
				</p>
			</div>
		</button>
	);
}
