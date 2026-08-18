import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Search } from "lucide-react";
import { useState } from "react";
import { isActiveConsultant } from "@/lib/auth-utils";
import { useProfile, useUser } from "@/stores/authStore";

type HeroPath = "post" | "hire";

/**
 * The marketplace's opening move: state a need, or go looking for someone.
 *
 * Both paths lead to surfaces that already exist — the project posting flow and
 * the consultant directory. The text box carries nothing into them yet, because
 * `/marketplace/project-posting` takes only `roadmapId`; wiring a description
 * through is a follow-up, not something to fake here.
 */
export function MarketplaceHero() {
	const user = useUser();
	const profile = useProfile();
	const navigate = useNavigate();
	const [path, setPath] = useState<HeroPath>("post");
	const [need, setNeed] = useState("");

	const firstName =
		profile?.first_name ?? profile?.display_name?.split(" ")[0] ?? null;

	const submit = () => {
		if (path === "post") {
			void navigate({
				to: "/marketplace/project-posting",
				search: { roadmapId: undefined },
			});
			return;
		}
		void navigate({ to: "/marketplace/consultant/browse" });
	};

	return (
		<section className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
			<div className="flex items-baseline justify-between gap-4">
				<h1 className="text-[15px] text-foreground">
					{firstName ? (
						<>
							Welcome, <span className="font-semibold">{firstName}</span>
						</>
					) : (
						<span className="font-semibold">Welcome to the marketplace</span>
					)}
				</h1>
				{user && isActiveConsultant(profile) && (
					<Link
						to="/marketplace/finance"
						search={{ tab: "contracts" }}
						className="text-[13px] font-medium text-primary hover:underline"
					>
						Your contracts
					</Link>
				)}
			</div>

			<div className="mt-3 rounded-2xl bg-primary px-6 py-8 text-primary-foreground">
				<div className="mx-auto max-w-2xl">
					<div className="mx-auto flex w-fit rounded-full bg-primary-foreground/10 p-1">
						<button
							type="button"
							onClick={() => setPath("post")}
							className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
								path === "post"
									? "bg-primary-foreground text-primary"
									: "text-primary-foreground/80 hover:text-primary-foreground"
							}`}
						>
							Post a project
						</button>
						<button
							type="button"
							onClick={() => setPath("hire")}
							className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
								path === "hire"
									? "bg-primary-foreground text-primary"
									: "text-primary-foreground/80 hover:text-primary-foreground"
							}`}
						>
							Hire a consultant
						</button>
					</div>

					<p className="mt-5 text-center text-[13px] text-primary-foreground/85">
						{path === "post" ? (
							<>
								Describe what you need and a vetted consultant will scope it —
								roadmap, deliverables and terms before any work starts.
							</>
						) : (
							<>
								Browse consultants who lead delivery end to end, then agree the
								scope in a signed contract.
							</>
						)}
					</p>

					<div className="mt-4 flex items-center gap-2 rounded-xl bg-primary-foreground p-1.5">
						<Search className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
						<input
							value={need}
							onChange={(event) => setNeed(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") submit();
							}}
							placeholder={
								path === "post"
									? "I need an AI-powered customer support platform…"
									: "Search consultants by name or expertise…"
							}
							className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-hidden placeholder:text-muted-foreground"
						/>
						<button
							type="button"
							onClick={submit}
							className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
						>
							{path === "post" ? "Post a project" : "Browse"}
							<ArrowRight className="h-3.5 w-3.5" />
						</button>
					</div>
				</div>
			</div>
		</section>
	);
}
