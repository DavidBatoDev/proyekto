import { Link } from "@tanstack/react-router";
import { Info, Smartphone, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { DocArticle } from "@/content/docs.manifest";
import { isNativeApp } from "@/lib/platform";

/**
 * The callouts an article gets from its manifest fields rather than from the
 * writer remembering to type them.
 *
 * That indirection is the point. "Every plan-gated article links to the plans
 * article" is a rule that decays the moment it lives in 10 separate markdown
 * files; as a field it cannot be forgotten, and the wording — which has to
 * agree with the product's own test-enforced limit copy — lives in exactly one
 * place.
 */

const TIER_LABEL: Record<NonNullable<DocArticle["plan"]>, string> = {
	pro: "Pro",
	business: "Business",
	enterprise: "Enterprise",
};

function Callout({
	icon: Icon,
	children,
}: {
	icon: typeof Info;
	children: ReactNode;
}) {
	return (
		<div className="mt-6 flex gap-3 border-l-2 border-border py-1 pl-4 text-sm text-muted-foreground">
			<Icon
				className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
				aria-hidden
			/>
			<div className="space-y-1">{children}</div>
		</div>
	);
}

/**
 * R1 — the plan callout.
 *
 * The second sentence is the product's own invariant, stated in `usageCopy.ts`
 * and asserted in its tests: a limit only ever blocks something new. Docs that
 * contradicted it would generate exactly the support tickets that wording
 * exists to prevent.
 *
 * Note it links to the docs plans article, never to /pricing — this component
 * renders inside the free mobile app.
 */
export function PlanCallout({
	plan,
}: {
	plan: NonNullable<DocArticle["plan"]>;
}) {
	return (
		<Callout icon={Sparkles}>
			<p>
				<span className="font-medium text-foreground">
					Available on {TIER_LABEL[plan]} and above.
				</span>{" "}
				Reaching a limit never removes anything you already have.
			</p>
			<p>
				<Link
					to="/docs/$section/$slug"
					params={{ section: "workspaces-and-plans", slug: "plans" }}
					className="font-medium text-primary underline underline-offset-4 hover:no-underline"
				>
					What each plan includes
				</Link>
			</p>
		</Callout>
	);
}

/** R2 — an optional, flag-gated feature that may simply not be switched on. */
export function FlaggedCallout() {
	return (
		<Callout icon={Info}>
			<p>
				This is optional and may not be enabled for your workspace. Check with a
				workspace owner before planning around it.
			</p>
		</Callout>
	);
}

/**
 * R3 — web only.
 *
 * Rendered on the web so a reader knows not to look for it on their phone. In
 * the app the article is unreachable anyway (platformSurfaces hides the whole
 * section), so this is belt and braces rather than the lock.
 */
export function WebOnlyCallout() {
	return (
		<Callout icon={Smartphone}>
			<p>
				This part of Proyekto is not in the installed app. Open it in a browser.
			</p>
		</Callout>
	);
}

/** Every callout an article's metadata calls for, in a fixed order. */
export function ArticleCallouts({ article }: { article: DocArticle }) {
	const native = isNativeApp();
	return (
		<>
			{article.plan ? <PlanCallout plan={article.plan} /> : null}
			{article.flagged ? <FlaggedCallout /> : null}
			{article.surface === "web" && !native ? <WebOnlyCallout /> : null}
		</>
	);
}
