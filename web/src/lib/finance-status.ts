/**
 * One status vocabulary for every money surface.
 *
 * Contracts, invoices and engagements each carry their own status column, and
 * before this module six files hand-rolled their own colour maps out of raw
 * Tailwind palette classes (emerald / amber / sky / rose / slate). Two problems
 * followed. The palette classes bypass the theme tokens the rest of the app is
 * built on, so they do not follow a theme swap; and every map covered only the
 * two or three statuses its own screen happened to show, collapsing `void`,
 * `cancelled`, `rejected`, `ended` and `overdue` into the same neutral grey as
 * `draft` — a voided invoice looked exactly like one still being written.
 *
 * Tones map onto the semantic tokens in styles.css (`--success`, `--warning`,
 * `--info`, `--destructive`) so light and dark are handled by the theme.
 */

export type FinanceTone = "neutral" | "info" | "warning" | "success" | "danger";

export interface FinanceStatusMeta {
	/** Sentence-case label. Raw DB values are snake_case and read badly. */
	label: string;
	tone: FinanceTone;
	/** One line of plain English, for tooltips and empty-state hints. */
	hint: string;
}

const STATUS_META: Record<string, FinanceStatusMeta> = {
	// Contracts
	draft: {
		label: "Draft",
		tone: "neutral",
		hint: "Still being written. Not visible to the other party.",
	},
	sent: {
		label: "Sent",
		tone: "info",
		hint: "With the other party, waiting for a signature.",
	},
	signed: {
		label: "Signed",
		tone: "success",
		hint: "Fully signed and in force.",
	},
	ended: {
		label: "Ended",
		tone: "neutral",
		hint: "Ran to the end of its term.",
	},
	superseded: {
		label: "Superseded",
		tone: "neutral",
		hint: "Replaced by a later version.",
	},
	cancelled: {
		label: "Cancelled",
		tone: "danger",
		hint: "Terminated before its end date.",
	},
	rejected: {
		label: "Rejected",
		tone: "danger",
		hint: "Declined by the other party.",
	},

	// Invoices
	issued: {
		label: "Issued",
		tone: "warning",
		hint: "Sent to the client. Waiting on payment.",
	},
	partially_paid: {
		label: "Part paid",
		tone: "warning",
		hint: "Some of the balance has been received.",
	},
	paid: {
		label: "Paid",
		tone: "success",
		hint: "Settled in full.",
	},
	void: {
		label: "Void",
		tone: "danger",
		hint: "Cancelled after issue. Carries no balance.",
	},
	overdue: {
		label: "Overdue",
		tone: "danger",
		hint: "Past its due date with a balance outstanding.",
	},

	// Engagements
	active: {
		label: "Active",
		tone: "success",
		hint: "Live commercial relationship.",
	},
};

const TONE_BADGE: Record<FinanceTone, string> = {
	neutral: "border-border bg-muted/60 text-muted-foreground",
	info: "border-info/30 bg-info/10 text-info-foreground",
	warning: "border-warning/40 bg-warning/10 text-warning-foreground",
	success: "border-success/30 bg-success/10 text-success-foreground",
	danger: "border-destructive/30 bg-destructive/10 text-destructive",
};

/** Text-only tone, for figures and inline copy that carry a status colour. */
const TONE_TEXT: Record<FinanceTone, string> = {
	neutral: "text-muted-foreground",
	info: "text-info-foreground",
	warning: "text-warning-foreground",
	success: "text-success-foreground",
	danger: "text-destructive",
};

const TONE_DOT: Record<FinanceTone, string> = {
	neutral: "bg-muted-foreground/60",
	info: "bg-info",
	warning: "bg-warning",
	success: "bg-success",
	danger: "bg-destructive",
};

export function financeStatusMeta(status: string): FinanceStatusMeta {
	const normalized = String(status ?? "")
		.toLowerCase()
		.replaceAll(" ", "_");
	return (
		STATUS_META[normalized] ?? {
			label: normalized ? sentenceCase(normalized) : "Unknown",
			tone: "neutral",
			hint: "",
		}
	);
}

export function financeStatusBadgeClass(tone: FinanceTone): string {
	return TONE_BADGE[tone];
}

export function financeStatusDotClass(tone: FinanceTone): string {
	return TONE_DOT[tone];
}

export function financeToneTextClass(tone: FinanceTone): string {
	return TONE_TEXT[tone];
}

/**
 * The status a reader cares about, which is not always the stored one: an
 * issued invoice ten days past its due date is, to everyone who looks at it,
 * overdue. `void` wins over everything — a cancelled invoice is never late.
 */
export function effectiveInvoiceStatus(invoice: {
	status: string;
	is_overdue?: boolean | null;
}): string {
	if (invoice.status === "void" || invoice.status === "paid") {
		return invoice.status;
	}
	return invoice.is_overdue ? "overdue" : invoice.status;
}

function sentenceCase(value: string): string {
	const spaced = value.replaceAll("_", " ");
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
