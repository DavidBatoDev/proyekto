import { AlertTriangle, Lock } from "lucide-react";
import { AppEmptyState } from "@/components/common/AppPrimitives";
import { isAccessDeniedError } from "@/lib/apiErrors";

export type FinanceAccessScope = "project" | "team" | "document";

/** Copy for a refusal, by what was refused. Exported for tests. */
export const FINANCE_NO_ACCESS_COPY: Record<
	FinanceAccessScope,
	{ title: string; description: string }
> = {
	project: {
		title: "You don't have finance access to this project.",
		description: "Ask the project owner for access.",
	},
	team: {
		title: "You don't have finance access to this team.",
		description: "Ask the team owner for access.",
	},
	document: {
		title: "You don't have finance access to this document.",
		description:
			"It belongs to a project whose finance you can't see. Ask the project owner for access.",
	},
};

/**
 * The page a caller sees when finance is not theirs to read. Rendered in place
 * of the content — never a spinner, never an empty list, because "nothing
 * here" and "not yours" are different answers.
 */
export function FinanceNoAccess({
	scope = "project",
	title,
	description,
	className,
}: {
	scope?: FinanceAccessScope;
	title?: string;
	description?: string;
	className?: string;
}) {
	const copy = FINANCE_NO_ACCESS_COPY[scope];
	return (
		<div role="alert" className={className}>
			<AppEmptyState
				icon={Lock}
				title={title ?? copy.title}
				description={description ?? copy.description}
			/>
		</div>
	);
}

/** A load that failed for a reason other than access. */
export function FinanceLoadError({
	error,
	onRetry,
	className,
}: {
	error: unknown;
	onRetry?: () => void;
	className?: string;
}) {
	const message =
		error instanceof Error && error.message
			? error.message
			: "Something went wrong while loading this.";
	return (
		<div role="alert" className={className}>
			<AppEmptyState
				icon={AlertTriangle}
				title="Couldn't load this"
				description={message}
				action={
					onRetry ? (
						<button
							type="button"
							onClick={onRetry}
							className="rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
						>
							Try again
						</button>
					) : undefined
				}
			/>
		</div>
	);
}

/**
 * The one error branch for a finance query: a refusal (401/403/404) reads as
 * "no access", anything else as a failure with a retry.
 */
export function FinanceQueryError({
	error,
	scope = "project",
	onRetry,
	className,
}: {
	error: unknown;
	scope?: FinanceAccessScope;
	onRetry?: () => void;
	className?: string;
}) {
	if (isAccessDeniedError(error)) {
		return <FinanceNoAccess scope={scope} className={className} />;
	}
	return (
		<FinanceLoadError error={error} onRetry={onRetry} className={className} />
	);
}
