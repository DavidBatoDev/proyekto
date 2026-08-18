import {
	ChevronLeft,
	ChevronRight,
	CircleDollarSign,
	Loader2,
} from "lucide-react";
import type { ReactNode } from "react";
import { AppEmptyState } from "@/components/common/AppPrimitives";
import {
	financeStatusBadgeClass,
	financeStatusDotClass,
	financeStatusMeta,
} from "@/lib/finance-status";

/**
 * The status pill used by every finance list.
 *
 * Colour and label both come from `lib/finance-status`, so a `void` invoice and
 * a `draft` one can no longer render identically the way they did when each
 * screen kept its own two-branch ternary.
 */
export function FinanceStatusBadge({
	status,
	className = "",
}: {
	status: string;
	className?: string;
}) {
	const meta = financeStatusMeta(status);
	return (
		<span
			title={meta.hint || undefined}
			className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${financeStatusBadgeClass(meta.tone)} ${className}`}
		>
			<span
				aria-hidden
				className={`h-1.5 w-1.5 rounded-full ${financeStatusDotClass(meta.tone)}`}
			/>
			{meta.label}
		</span>
	);
}

export function FinanceSectionHeading({
	eyebrow,
	title,
	description,
	count,
	actions,
}: {
	eyebrow: string;
	title: string;
	description: string;
	count?: string;
	actions?: ReactNode;
}) {
	return (
		<div className="flex flex-col justify-between gap-3 pt-1 sm:flex-row sm:items-end">
			<div className="min-w-0">
				<p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
					{eyebrow}
				</p>
				<h2 className="mt-1 text-xl font-bold tracking-tight text-foreground">
					{title}
				</h2>
				<p className="mt-1 text-sm text-muted-foreground">{description}</p>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				{count && (
					<span className="w-fit rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm">
						{count}
					</span>
				)}
				{actions}
			</div>
		</div>
	);
}

export function FinanceLoading() {
	return (
		<div className="flex justify-center py-16">
			<Loader2 className="h-6 w-6 animate-spin text-primary" />
		</div>
	);
}

export function NoFinanceData({
	title = "No finance records match",
	description = "Adjust the filters or choose another project.",
}: {
	title?: string;
	description?: string;
}) {
	return (
		<AppEmptyState
			icon={CircleDollarSign}
			title={title}
			description={description}
		/>
	);
}

/**
 * A yyyy-mm-dd column rendered the way a person reads dates.
 *
 * The invoice list printed the raw ISO string while every other date on the
 * page went through Intl, so one row read "Due 2026-08-31" and the next
 * "Aug 31, 2026".
 */
export function formatFinanceDate(value?: string | null): string | null {
	if (!value) return null;
	const parsed = new Date(`${value}T00:00:00`);
	if (Number.isNaN(parsed.getTime())) return value;
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(parsed);
}

/** English plural without dragging in a formatting library for two words. */
export function countLabel(n: number, singular: string, plural?: string) {
	return `${n.toLocaleString()} ${n === 1 ? singular : (plural ?? `${singular}s`)}`;
}

/**
 * The pager the finance lists never had.
 *
 * The API has accepted `page`/`limit` since it shipped and returns an exact
 * `total`, but the client sent neither and rendered no control — so a
 * consultant with more than 50 invoices simply never saw the rest of them, with
 * nothing on screen to say so.
 */
export function FinancePager({
	page,
	limit,
	total,
	onChange,
}: {
	page: number;
	limit: number;
	total: number;
	onChange: (page: number) => void;
}) {
	const pageCount = Math.max(1, Math.ceil(total / limit));
	if (pageCount <= 1) return null;
	const first = (page - 1) * limit + 1;
	const last = Math.min(total, page * limit);

	return (
		<nav
			aria-label="Pagination"
			className="flex items-center justify-between gap-3 px-1"
		>
			<p className="text-xs text-muted-foreground tabular-nums">
				{first.toLocaleString()}–{last.toLocaleString()} of{" "}
				{total.toLocaleString()}
			</p>
			<div className="flex items-center gap-1">
				<PagerButton
					label="Previous page"
					disabled={page <= 1}
					onClick={() => onChange(page - 1)}
				>
					<ChevronLeft className="h-4 w-4" />
				</PagerButton>
				<span className="px-2 text-xs font-semibold text-foreground tabular-nums">
					{page} / {pageCount}
				</span>
				<PagerButton
					label="Next page"
					disabled={page >= pageCount}
					onClick={() => onChange(page + 1)}
				>
					<ChevronRight className="h-4 w-4" />
				</PagerButton>
			</div>
		</nav>
	);
}

function PagerButton({
	label,
	disabled,
	onClick,
	children,
}: {
	label: string;
	disabled: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
		>
			{children}
		</button>
	);
}
