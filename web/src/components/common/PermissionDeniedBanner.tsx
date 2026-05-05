import { ShieldAlert } from "lucide-react";
import {
	formatMissingPermission,
	getPermissionLabel,
	parseMissingPermissionError,
	type ParsedPermissionError,
} from "@/lib/permissionErrors";

/**
 * Inline banner used on full-page or full-card surfaces when a 403
 * `missing_permission` is the reason the data couldn't load. Pass
 * either a parsed `ParsedPermissionError` or any unknown error and we'll
 * try to parse it; the component returns `null` when the error isn't a
 * structured permission failure (so callers can keep their existing
 * generic-error UI for non-permission failures).
 */
export function PermissionDeniedBanner({
	error,
	parsed,
	className = "",
}: {
	error?: unknown;
	parsed?: ParsedPermissionError;
	className?: string;
}) {
	const resolved = parsed ?? (error ? parseMissingPermissionError(error) : null);
	if (!resolved) return null;

	const headline = formatMissingPermission(resolved);
	const catalogLabel = getPermissionLabel(resolved.path);

	return (
		<div
			className={`flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-sm ${className}`}
			role="status"
			aria-live="polite"
		>
			<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-300 bg-amber-100">
				<ShieldAlert className="h-4 w-4 text-amber-700" />
			</div>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-semibold">Permission required</p>
				<p className="mt-0.5 text-sm leading-relaxed text-amber-900/85">
					{headline}
				</p>
				{(resolved.path || resolved.requiredRole) && (
					<div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
						{resolved.path && (
							<code className="rounded border border-amber-300 bg-white/70 px-1.5 py-0.5 font-mono text-amber-900">
								{resolved.path}
							</code>
						)}
						{resolved.requiredRole && (
							<span className="rounded border border-amber-300 bg-white/70 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-amber-900">
								Min role: {resolved.requiredRole}
							</span>
						)}
						{catalogLabel && (
							<span className="text-amber-900/70">
								Ask a project owner or admin to grant this.
							</span>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
