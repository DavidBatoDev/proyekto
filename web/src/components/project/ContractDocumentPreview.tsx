import { Maximize2, PanelRightClose, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	SIGNATURE_BASE_HEIGHT_PX,
	SIGNATURE_COMPACT_BASE_HEIGHT_PX,
	SIGNATURE_COMPACT_FIELD_HEIGHT_PX,
	SIGNATURE_FIELD_HEIGHT_PX,
} from "@/components/project/signature/signature-constants";
import {
	type BillingMode,
	formatContractDate,
	formatMoney,
} from "@/lib/contract-term";
import {
	type ContractVariableDefinition,
	type ContractVariableValues,
	findContractVariables,
	renderContractVariables,
	resolveContractVariable,
} from "@/lib/contract-variables";
import type {
	BillingTiming,
	ContractClause,
	ContractPeriod,
	ContractService,
} from "@/services/contract.service";

/**
 * The slice of a contract the document actually renders.
 *
 * Narrower than `Contract` on purpose: the public signing page is served a
 * whitelist projection with no project_id, created_by or internal notes, and
 * typing the preview against that slice is what lets it render the same
 * document for a signer who has no account. A full `Contract` still satisfies it.
 */
export interface ContractDocumentView {
	contract_number: string | null;
	service_start_date: string | null;
	service_end_date: string | null;
	clauses: ContractClause[];
	services: ContractService[];
	periods: ContractPeriod[];
	signed_by_consultant_at: string | null;
	signed_by_consultant_name: string | null;
	signed_by_consultant_signature_url: string | null;
	signed_by_consultant_signature_scale: number;
	signed_by_consultant_signature_offset_x: number;
	signed_by_consultant_signature_offset_y: number;
	signed_by_client_at: string | null;
	signed_by_client_name: string | null;
	signed_by_client_signature_url: string | null;
	signed_by_client_signature_scale: number;
	signed_by_client_signature_offset_x: number;
	signed_by_client_signature_offset_y: number;
}

/**
 * A live, paper-styled preview of the service agreement — the document the
 * client will see — rendered from the in-progress edits so the consultant can
 * watch it fill in while they work. Mirrors the structure of the server-side
 * `agreement-pdf.renderer` (provider header, commercial-terms table, numbered
 * clauses, signature block) so the on-screen preview and the eventual PDF read
 * the same.
 *
 * It renders compact in the side rail and, via the Expand control, full-size in
 * a centred modal for actual reading — the same `PaperDocument` at two scales.
 *
 * The paper is intentionally light in both themes: a contract is a white
 * document, and keeping it white (rather than flipping to a dark surface) is
 * what makes it read as "the paper" instead of another app panel.
 */

/** The subset of party fields the document shows, fed live from the editor. */
export interface PreviewParties extends ContractVariableValues {
	provider_name: string;
	provider_address: string;
	client_name: string;
	client_contact_name: string;
	client_address: string;
}

/** The subset of commercial terms the document shows, fed live from the editor. */
export interface PreviewTerms {
	currency: string;
	billing_mode: BillingMode;
	fixed_fee: string;
	recurring_fee: string;
	client_hourly_rate: string;
	service_description: string;
	payment_method: string;
	due_days: string;
	billing_timing: BillingTiming;
	auto_renew: boolean;
	notice_days: string;
}

export type ContractDocumentSection =
	| "parties"
	| "terms"
	| "services"
	| "agreement"
	| "signatures";

export interface ContractClauseOutlineItem {
	clause: ContractClause;
	number: string;
	depth: number;
}

/**
 * Turns the stored flat JSON list into legal-style outline numbering. Existing
 * clauses without a parent remain top-level, so older contracts need no data
 * migration. Invalid/cyclic parent links fall back to top-level entries rather
 * than disappearing from a signed document.
 */
export function contractClauseOutline(
	clauses: ContractClause[],
): ContractClauseOutlineItem[] {
	const ordered = [...clauses].sort(
		(left, right) => left.position - right.position,
	);
	const keys = new Set(ordered.map((clause) => clause.key));
	const children = new Map<string | null, ContractClause[]>();
	const parentFor = (clause: ContractClause) =>
		clause.parent_key && keys.has(clause.parent_key) ? clause.parent_key : null;

	for (const clause of ordered) {
		const parent = parentFor(clause);
		const siblings = children.get(parent) ?? [];
		siblings.push(clause);
		children.set(parent, siblings);
	}

	const outline: ContractClauseOutlineItem[] = [];
	const visited = new Set<string>();
	const visit = (parent: string | null, prefix: string, depth: number) => {
		for (const [index, clause] of (children.get(parent) ?? []).entries()) {
			if (visited.has(clause.key)) continue;
			const number = prefix ? `${prefix}.${index + 1}` : String(index + 1);
			visited.add(clause.key);
			outline.push({ clause, number, depth });
			visit(clause.key, number, depth + 1);
		}
	};

	visit(null, "", 0);
	// A circular parent reference has no root. Keep it visible rather than
	// silently dropping legal text from the agreement.
	for (const clause of ordered) {
		if (visited.has(clause.key)) continue;
		const number = String(
			outline.filter((item) => item.depth === 0).length + 1,
		);
		visited.add(clause.key);
		outline.push({ clause, number, depth: 0 });
		visit(clause.key, number, 1);
	}
	return outline;
}

function renderClause(body: string, parties: ContractVariableValues): string {
	return renderContractVariables(body, parties)
		.map((part) => (typeof part === "string" ? part : part.label))
		.join("");
}

/** Removes the display-only legal number added to an editable clause heading. */
export function stripClauseNumberPrefix(title: string): string {
	return title.replace(/^\d+(?:\.\d+)*\.\s*/, "");
}

function renderEditableClause(body: string, parties: PreviewParties) {
	return renderContractVariables(body, parties).map((part) => {
		if (typeof part === "string") return part;
		return (
			<span
				key={part.key}
				contentEditable={false}
				data-contract-token={part.token}
				className="mx-0.5 inline-flex rounded bg-blue-100 px-1 py-0.5 font-medium text-blue-800"
			>
				{part.label}
			</span>
		);
	});
}

function serializeEditableClause(element: HTMLElement): string {
	const readNode = (node: Node): string => {
		if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
		if (!(node instanceof HTMLElement)) return "";
		const token = node.dataset.contractToken;
		if (token) return token;
		if (node.tagName === "BR") return "\n";
		const contents = Array.from(node.childNodes).map(readNode).join("");
		return node.tagName === "DIV" ? `${contents}\n` : contents;
	};
	return Array.from(element.childNodes)
		.map(readNode)
		.join("")
		.replace(/\n+$/, "");
}

interface ContractVariableMentionState {
	query: string;
	anchorNode: Text;
	anchorOffset: number;
	position: { left: number; top: number };
	activeIndex: number;
}

function ContractEditableText({
	value,
	parties,
	className,
	singleLine = false,
	clauseKey,
	onCommit,
	onFocus,
}: {
	value: string;
	parties: PreviewParties;
	className: string;
	singleLine?: boolean;
	clauseKey?: string;
	onCommit: (value: string) => void;
	onFocus?: () => void;
}) {
	const editorRef = useRef<HTMLElement>(null);
	const [mention, setMention] = useState<ContractVariableMentionState | null>(
		null,
	);
	const candidates = mention
		? findContractVariables(mention.query, parties)
		: [];

	const closeMention = () => setMention(null);
	const commit = () => {
		if (editorRef.current) onCommit(serializeEditableClause(editorRef.current));
	};
	const insertMention = (variable: ContractVariableDefinition) => {
		if (!mention || !editorRef.current) return closeMention();
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return closeMention();
		const range = document.createRange();
		range.setStart(mention.anchorNode, mention.anchorOffset);
		const cursor = selection.getRangeAt(0);
		range.setEnd(cursor.endContainer, cursor.endOffset);
		range.deleteContents();

		const token = document.createElement("span");
		token.contentEditable = "false";
		token.dataset.contractToken = variable.token;
		token.className =
			"mx-0.5 inline-flex rounded bg-blue-100 px-1 py-0.5 font-medium text-blue-800";
		token.textContent =
			resolveContractVariable(variable.token, parties) ?? variable.label;
		range.insertNode(token);
		const trailingSpace = document.createTextNode(" ");
		token.after(trailingSpace);
		const nextRange = document.createRange();
		nextRange.setStartAfter(trailingSpace);
		nextRange.collapse(true);
		selection.removeAllRanges();
		selection.addRange(nextRange);
		closeMention();
		editorRef.current.focus();
	};

	const inspectMention = () => {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return closeMention();
		const range = selection.getRangeAt(0);
		if (range.startContainer.nodeType !== Node.TEXT_NODE) return closeMention();
		const node = range.startContainer as Text;
		const beforeCursor = (node.textContent ?? "").slice(0, range.startOffset);
		const match = /(?:^|\s)@([\w -]*)$/.exec(beforeCursor);
		if (!match) return closeMention();
		const atOffset =
			beforeCursor.length -
			match[0].length +
			(match[0].startsWith(" ") ? 1 : 0);
		const atRange = document.createRange();
		atRange.setStart(node, atOffset);
		atRange.setEnd(node, atOffset + 1);
		const rect = atRange.getBoundingClientRect();
		setMention({
			query: match[1],
			anchorNode: node,
			anchorOffset: atOffset,
			position: { left: rect.left, top: rect.bottom + 4 },
			activeIndex: 0,
		});
	};

	return (
		<>
			<span
				ref={editorRef}
				contentEditable
				suppressContentEditableWarning
				data-contract-clause={clauseKey}
				onFocus={onFocus}
				onInput={inspectMention}
				onKeyDown={(event) => {
					if (mention) {
						if (event.key === "ArrowDown" || event.key === "ArrowUp") {
							event.preventDefault();
							setMention((current) =>
								current
									? {
											...current,
											activeIndex: Math.max(
												0,
												Math.min(
													current.activeIndex +
														(event.key === "ArrowDown" ? 1 : -1),
													candidates.length - 1,
												),
											),
										}
									: current,
							);
							return;
						}
						if (event.key === "Enter" || event.key === "Tab") {
							event.preventDefault();
							const selected = candidates[mention.activeIndex];
							if (selected) insertMention(selected);
							return;
						}
						if (event.key === "Escape") {
							event.preventDefault();
							closeMention();
							return;
						}
					}
					if (singleLine && event.key === "Enter") {
						event.preventDefault();
						event.currentTarget.blur();
					}
				}}
				onBlur={() => {
					commit();
					window.setTimeout(closeMention, 120);
				}}
				className={className}
			>
				{renderEditableClause(value, parties)}
			</span>
			{mention &&
				candidates.length > 0 &&
				createPortal(
					<div
						role="listbox"
						className="fixed z-[100] min-w-64 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-xl"
						style={mention.position}
					>
						{candidates.map((variable, index) => (
							<button
								key={variable.token}
								type="button"
								role="option"
								aria-selected={index === mention.activeIndex}
								onMouseDown={(event) => {
									event.preventDefault();
									insertMention(variable);
								}}
								className={`flex w-full items-center justify-between gap-5 px-3 py-2 text-left text-xs ${
									index === mention.activeIndex
										? "bg-muted text-foreground"
										: "text-muted-foreground hover:bg-muted"
								}`}
							>
								<span className="font-medium text-foreground">
									{variable.label}
								</span>
								<span className="max-w-44 truncate text-[11px]">
									{resolveContractVariable(variable.token, parties)}
								</span>
							</button>
						))}
					</div>,
					document.body,
				)}
		</>
	);
}

export interface ContractClauseFragment {
	text: string;
	start: number;
	end: number;
}

/**
 * Long legal paragraphs are divided into stable, word-bound fragments so the
 * A4 paginator can move them independently instead of clipping an oversized
 * clause. Short clauses remain a single directly editable block.
 */
export function splitContractClauseBody(
	body: string,
	maxCharacters = 900,
): ContractClauseFragment[] {
	if (body.length <= maxCharacters) {
		return [{ text: body, start: 0, end: body.length }];
	}

	const fragments: ContractClauseFragment[] = [];
	let start = 0;
	while (start < body.length) {
		let end = Math.min(body.length, start + maxCharacters);
		if (end < body.length) {
			const minimumBreak = start + Math.floor(maxCharacters * 0.55);
			const newline = body.lastIndexOf("\n", end);
			const whitespace = body.lastIndexOf(" ", end);
			const candidate = Math.max(newline, whitespace);
			if (candidate >= minimumBreak) end = candidate + 1;
		}
		fragments.push({ text: body.slice(start, end), start, end });
		start = end;
	}
	return fragments.length > 0 ? fragments : [{ text: "", start: 0, end: 0 }];
}

function num(value: string): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function billingLine(terms: PreviewTerms): string {
	if (terms.billing_mode === "retainer") {
		return `${formatMoney(terms.currency, num(terms.recurring_fee))} / period`;
	}
	if (terms.billing_mode === "time_based") {
		return `${formatMoney(terms.currency, num(terms.client_hourly_rate))} / hour`;
	}
	if (terms.billing_mode === "fixed") {
		return `${formatMoney(terms.currency, num(terms.fixed_fee))} fixed amount`;
	}
	return `${formatMoney(terms.currency, num(terms.recurring_fee))} / period + overage`;
}

export function ContractDocumentPreview({
	contract,
	parties,
	terms,
	onHide,
	mode = "panel",
	activeSection,
	onSectionSelect,
	editable = false,
	onClauseChange,
}: {
	contract: ContractDocumentView;
	parties: PreviewParties;
	terms: PreviewTerms;
	mode?: "panel" | "canvas";
	activeSection?: ContractDocumentSection;
	onSectionSelect?: (section: ContractDocumentSection) => void;
	editable?: boolean;
	onClauseChange?: (
		key: string,
		patch: Partial<Pick<ContractClause, "title" | "body">>,
	) => void;
	/**
	 * Collapse the preview column entirely. The panel is a fixed 480px of a
	 * 1440px page, which squeezed every form field beside it to ~310px — wide
	 * enough for "Net 15", not for a company address.
	 */
	onHide?: () => void;
}) {
	const [expanded, setExpanded] = useState(false);

	return (
		<>
			<div
				className={`overflow-hidden border border-border shadow-sm ${
					mode === "canvas" ? "rounded-2xl bg-muted/30" : "rounded-xl bg-card"
				}`}
			>
				<div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
					<div>
						<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
							{mode === "canvas" ? "Document editor" : "Live preview"}
						</p>
						{mode === "canvas" && (
							<p className="mt-0.5 text-[11px] text-muted-foreground">
								{editable
									? "Select a section to edit its details"
									: "Select a section to review its details"}
							</p>
						)}
					</div>
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={() => setExpanded(true)}
							className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-primary transition hover:bg-primary/10"
						>
							<Maximize2 className="h-3 w-3" />
							Expand
						</button>
						{onHide && (
							<button
								type="button"
								onClick={onHide}
								className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
							>
								<PanelRightClose className="h-3 w-3" />
								Hide
							</button>
						)}
					</div>
				</div>
				<div
					className={
						mode === "canvas"
							? "max-h-[calc(100vh-13rem)] overflow-y-auto bg-muted/20 p-3 md:p-5"
							: "max-h-[75vh] overflow-y-auto"
					}
				>
					<div
						className={
							mode === "canvas"
								? "mx-auto max-w-[760px] overflow-hidden rounded-sm shadow-lg ring-1 ring-black/5"
								: undefined
						}
					>
						<ContractPaperDocument
							contract={contract}
							parties={parties}
							terms={terms}
							large={mode === "canvas"}
							activeSection={activeSection}
							onSectionSelect={onSectionSelect}
							editable={editable}
							onClauseChange={onClauseChange}
						/>
					</div>
				</div>
			</div>

			{expanded && (
				<ExpandedPreview onClose={() => setExpanded(false)}>
					<ContractPaperDocument
						contract={contract}
						parties={parties}
						terms={terms}
						large
					/>
				</ExpandedPreview>
			)}
		</>
	);
}

/**
 * Full-size document modal: backdrop-click and Escape both close it. Rendered
 * through a portal to `document.body` so it escapes the contract page's stacking
 * context (an ancestor there creates one, which otherwise traps the overlay
 * beneath the app header regardless of its z-index).
 */
function ExpandedPreview({
	onClose,
	children,
}: {
	onClose: () => void;
	children: React.ReactNode;
}) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		// Lock background scroll while the overlay is open.
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = prevOverflow;
		};
	}, [onClose]);

	return createPortal(
		<div className="fixed inset-0 z-80 flex items-start justify-center overflow-y-auto p-4 py-10 sm:p-8">
			{/* Backdrop as a sibling button (not a parent), so the content it sits
			    above never nests inside an interactive element. */}
			<button
				type="button"
				aria-label="Close preview"
				onClick={onClose}
				className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
			/>
			<div className="relative w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-2xl">
				<div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3">
					<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
						Service Agreement — preview
					</p>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1 text-slate-500 transition hover:bg-slate-200"
						aria-label="Close"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
				<div className="max-h-[80vh] overflow-y-auto">{children}</div>
			</div>
		</div>,
		document.body,
	);
}

export function ContractPaperDocument({
	contract,
	parties,
	terms,
	large,
	activeSection,
	onSectionSelect,
	editable,
	onClauseChange,
	blockIds,
}: {
	contract: ContractDocumentView;
	parties: PreviewParties;
	terms: PreviewTerms;
	large?: boolean;
	activeSection?: ContractDocumentSection;
	onSectionSelect?: (section: ContractDocumentSection) => void;
	editable?: boolean;
	onClauseChange?: (
		key: string,
		patch: Partial<Pick<ContractClause, "title" | "body">>,
	) => void;
	/** Render only these measured document blocks. Used by the A4 paginator. */
	blockIds?: ReadonlySet<string>;
}) {
	const provider = parties.provider_name.trim() || "Service Provider";
	const client = parties.client_name.trim() || "Client";
	const includesBlock = (id: string) => !blockIds || blockIds.has(id);
	const clauseOutline = contractClauseOutline(contract.clauses);
	const topLevelClauseCount = clauseOutline.filter(
		(item) => item.depth === 0,
	).length;

	const termRows: Array<{ label: string; value: string }> = [
		{ label: "Billing", value: billingLine(terms) },
		{ label: "Currency", value: terms.currency || "—" },
		{
			label: "Service period",
			value: `${formatContractDate(contract.service_start_date)} – ${formatContractDate(contract.service_end_date)}`,
		},
		{
			label: "Invoicing",
			value:
				terms.billing_timing === "advance"
					? "In advance, before each period begins"
					: "In arrears, after each period is delivered",
		},
		{
			label: "Payment terms",
			value: terms.due_days ? `Net ${terms.due_days} days` : "—",
		},
		{
			label: "Renewal",
			value: terms.auto_renew
				? "Renews automatically at the end of the term"
				: "Ends at the end of the term",
		},
		{
			label: "Notice to cancel",
			value: terms.notice_days ? `${terms.notice_days} days` : "—",
		},
		{ label: "Billing periods", value: String(contract.periods.length) },
	];
	if (terms.service_description.trim()) {
		termRows.push({ label: "Scope", value: terms.service_description.trim() });
	}
	if (terms.payment_method.trim()) {
		termRows.push({
			label: "Payment method",
			value: terms.payment_method.trim(),
		});
	}

	return (
		<div
			data-contract-paper
			className={`bg-white text-[#1f2937] ${
				large
					? "px-16 py-12 text-sm leading-relaxed"
					: "px-5 py-5 text-[12px] leading-relaxed"
			}`}
		>
			{/* Provider header */}
			{includesBlock("header") && (
				<div data-contract-block="header">
					{/* Letterhead: the issuing party, in full. The document used to
					    print only a name and an email, dropping the registered address
					    and TIN it already held — the two things that make a service
					    agreement identify a real legal entity. */}
					<div className="flex items-start justify-between gap-6">
						<div className="min-w-0">
							<p
								className={`font-semibold text-[#111827] ${large ? "text-base" : "text-[13px]"}`}
							>
								{provider}
							</p>
							<div
								className={`mt-0.5 space-y-0.5 text-[#6b7280] ${large ? "text-[11px]" : "text-[9px]"}`}
							>
								{parties.provider_address && <p>{parties.provider_address}</p>}
								{parties.provider_tin && <p>TIN {parties.provider_tin}</p>}
								{parties.provider_email && <p>{parties.provider_email}</p>}
							</div>
						</div>
						<div className="shrink-0 text-right">
							{contract.contract_number && (
								<p
									className={`font-semibold text-[#111827] tabular-nums ${large ? "text-[11px]" : "text-[9px]"}`}
								>
									{contract.contract_number}
								</p>
							)}
							<p
								className={`text-[#9ca3af] ${large ? "text-[11px]" : "text-[9px]"}`}
							>
								{formatContractDate(contract.service_start_date)}
							</p>
						</div>
					</div>

					{/* The title carries the document's one accent, as a rule beneath
					    it rather than as coloured type — a contract's title is ink. */}
					<div className={large ? "mt-8" : "mt-5"}>
						<h1
							className={`text-center font-semibold tracking-tight text-[#111827] ${large ? "text-[22px]" : "text-base"}`}
						>
							Service Agreement
						</h1>
						<div
							className={`mx-auto mt-2 h-[2px] bg-[#2563eb] ${large ? "w-16" : "w-10"}`}
						/>
					</div>
				</div>
			)}

			{/* Parties */}
			{includesBlock("parties") && (
				<DocumentRegion
					blockId="parties"
					section="parties"
					active={activeSection === "parties"}
					onSelect={onSectionSelect}
					editable={editable}
				>
					<div className="mt-5 grid grid-cols-2 gap-4">
						<PartyBlock
							heading="Service Provider"
							name={provider}
							address={parties.provider_address}
							large={large}
						/>
						<PartyBlock
							heading="Client"
							name={client}
							contact={parties.client_contact_name}
							address={parties.client_address}
							large={large}
						/>
					</div>
				</DocumentRegion>
			)}

			{/* Commercial terms */}
			{includesBlock("terms") && (
				<DocumentRegion
					blockId="terms"
					section="terms"
					active={activeSection === "terms"}
					onSelect={onSectionSelect}
					editable={editable}
				>
					<Section title="Commercial Terms" large={large}>
						<dl className="mt-1 space-y-1">
							{termRows.map((row) => (
								<div key={row.label} className="flex gap-3">
									<dt
										className={`shrink-0 text-[#9ca3af] ${large ? "w-36" : "w-28"}`}
									>
										{row.label}
									</dt>
									<dd className="font-medium text-[#1f2937]">{row.value}</dd>
								</div>
							))}
						</dl>
					</Section>
				</DocumentRegion>
			)}

			{/* Services */}
			{contract.services.length > 0 && includesBlock("services") && (
				<DocumentRegion
					blockId="services"
					section="services"
					active={activeSection === "services"}
					onSelect={onSectionSelect}
					editable={editable}
				>
					<Section title="Services" large={large}>
						<ul className="mt-1 space-y-0.5">
							{contract.services.map((service: ContractService) => (
								<li key={service.id} className="flex justify-between gap-3">
									<span className="text-[#374151]">
										{service.name || "Untitled service"}
									</span>
									<span className="tabular-nums text-[#6b7280]">
										{formatMoney(terms.currency, service.unit_rate)}
										{service.unit ? ` / ${service.unit}` : ""}
									</span>
								</li>
							))}
						</ul>
					</Section>
				</DocumentRegion>
			)}

			{/* Clauses are measured separately for pagination, but selected as one
			    agreement region so the editor shows one outline instead of a stack of
			    competing boxes. */}
			{clauseOutline.some(({ clause }) =>
				splitContractClauseBody(clause.body).some((_, index) =>
					includesBlock(`clause:${clause.key}:${index}`),
				),
			) && (
				<AgreementRegion
					active={activeSection === "agreement"}
					onSelect={onSectionSelect}
					editable={editable}
				>
					{clauseOutline.flatMap(({ clause, number, depth }) =>
						splitContractClauseBody(clause.body).map(
							(fragment, fragmentIndex) => {
								const blockId = `clause:${clause.key}:${fragmentIndex}`;
								if (!includesBlock(blockId)) return null;
								return (
									<DocumentRegion
										key={blockId}
										blockId={blockId}
										section="agreement"
										active={false}
										containMargins
									>
										<div className={depth > 0 ? "ml-6" : undefined}>
											<Section
												title={`${number}. ${clause.title}${fragmentIndex > 0 ? " (continued)" : ""}`}
												large={large}
												titleEditable={editable && fragmentIndex === 0}
												titleParties={parties}
												onTitleChange={(title) =>
													onClauseChange?.(clause.key, {
														title: stripClauseNumberPrefix(title),
													})
												}
											>
												{editable ? (
													<ContractEditableText
														value={fragment.text}
														parties={parties}
														clauseKey={clause.key}
														onFocus={() => onSectionSelect?.("agreement")}
														onCommit={(body) =>
															onClauseChange?.(clause.key, {
																body: `${clause.body.slice(0, fragment.start)}${body}${clause.body.slice(fragment.end)}`,
															})
														}
														className="mt-1 block whitespace-pre-wrap outline-none cursor-text rounded px-1 py-0.5 hover:bg-blue-50 focus:bg-blue-50 focus:ring-2 focus:ring-blue-200"
													/>
												) : (
													<p className="mt-1 whitespace-pre-wrap">
														{renderClause(fragment.text, parties)}
													</p>
												)}
											</Section>
										</div>
									</DocumentRegion>
								);
							},
						),
					)}
				</AgreementRegion>
			)}
			{/* Signatures */}
			{includesBlock("signatures") && (
				<DocumentRegion
					blockId="signatures"
					section="signatures"
					active={activeSection === "signatures"}
					onSelect={onSectionSelect}
					editable={editable}
				>
					<Section
						title={`${topLevelClauseCount + 1}. Signature`}
						large={large}
					>
						<div className="mt-2 grid grid-cols-2 gap-4">
							<SignatureColumn
								heading={`For ${client}`}
								name={contract.signed_by_client_name}
								at={contract.signed_by_client_at}
								imageUrl={contract.signed_by_client_signature_url}
								imageScale={contract.signed_by_client_signature_scale}
								imageOffsetX={contract.signed_by_client_signature_offset_x}
								imageOffsetY={contract.signed_by_client_signature_offset_y}
								large={large}
							/>
							<SignatureColumn
								heading={`For ${provider}`}
								name={contract.signed_by_consultant_name}
								at={contract.signed_by_consultant_at}
								imageUrl={contract.signed_by_consultant_signature_url}
								imageScale={contract.signed_by_consultant_signature_scale}
								imageOffsetX={contract.signed_by_consultant_signature_offset_x}
								imageOffsetY={contract.signed_by_consultant_signature_offset_y}
								large={large}
							/>
						</div>
					</Section>
				</DocumentRegion>
			)}
		</div>
	);
}

function PartyBlock({
	heading,
	name,
	contact,
	address,
	large,
}: {
	heading: string;
	name: string;
	contact?: string;
	address?: string;
	large?: boolean;
}) {
	return (
		<div>
			<p
				className={`font-semibold uppercase tracking-wide text-[#9ca3af] ${large ? "text-xs" : "text-[10px]"}`}
			>
				{heading}
			</p>
			<p className="mt-0.5 font-semibold text-[#111827]">{name}</p>
			{contact && contact !== name && (
				<p className="text-[#6b7280]">Contact: {contact}</p>
			)}
			{address && <p className="text-[#6b7280]">{address}</p>}
		</div>
	);
}

function Section({
	title,
	large,
	children,
	titleEditable = false,
	titleParties,
	onTitleChange,
}: {
	title: string;
	large?: boolean;
	children: React.ReactNode;
	titleEditable?: boolean;
	titleParties?: PreviewParties;
	onTitleChange?: (title: string) => void;
}) {
	return (
		<div className="mt-4">
			{titleEditable && titleParties ? (
				<ContractEditableText
					value={title}
					parties={titleParties}
					singleLine
					onCommit={(value) => onTitleChange?.(value)}
					className={`block font-bold text-[#111827] outline-none ${large ? "text-sm" : "text-[11px]"} cursor-text rounded px-1 py-0.5 hover:bg-blue-50 focus:bg-blue-50 focus:ring-2 focus:ring-blue-200`}
				/>
			) : (
				<p
					className={`font-bold text-[#111827] ${large ? "text-sm" : "text-[11px]"}`}
				>
					{renderClause(title, titleParties ?? {})}
				</p>
			)}
			{children}
		</div>
	);
}

function DocumentRegion({
	blockId,
	section,
	active,
	onSelect,
	editable,
	showStatus = true,
	containMargins = false,
	children,
}: {
	blockId?: string;
	section: ContractDocumentSection;
	active: boolean;
	onSelect?: (section: ContractDocumentSection) => void;
	editable?: boolean;
	showStatus?: boolean;
	/** Keep a child section's top margin inside this measured pagination block. */
	containMargins?: boolean;
	children: React.ReactNode;
}) {
	if (!onSelect) {
		return blockId ? (
			<div
				data-contract-block={blockId}
				className={containMargins ? "flow-root" : undefined}
			>
				{children}
			</div>
		) : (
			children
		);
	}
	return (
		<div
			data-contract-block={blockId}
			role="button"
			tabIndex={0}
			aria-label={`${editable ? "Edit" : "View"} ${section} section`}
			onClick={() => onSelect(section)}
			onKeyDown={(event) => {
				if (event.target !== event.currentTarget) return;
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onSelect(section);
				}
			}}
			className={`group/region relative -mx-3 rounded-lg border px-3 py-1 outline-none transition ${
				active
					? "border-blue-300 bg-blue-50/60 ring-2 ring-blue-100"
					: "border-transparent hover:border-blue-200 hover:bg-blue-50/30 focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
			}`}
		>
			{active && showStatus && (
				<span className="absolute right-2 top-1 z-10 rounded bg-blue-600 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
					{editable ? "Editing" : "Selected"}
				</span>
			)}
			{children}
		</div>
	);
}

/**
 * The agreement contains many independently paginated clause blocks. This
 * wrapper deliberately has no border or padding in layout; its absolute
 * overlay gives the whole visible agreement one selection outline without
 * changing the measurements that decide where A4 page breaks land.
 */
function AgreementRegion({
	active,
	onSelect,
	editable,
	children,
}: {
	active: boolean;
	onSelect?: (section: ContractDocumentSection) => void;
	editable?: boolean;
	children: React.ReactNode;
}) {
	if (!onSelect) return children;

	return (
		<div
			role="button"
			tabIndex={0}
			aria-label={`${editable ? "Edit" : "View"} agreement section`}
			onClick={() => onSelect("agreement")}
			onKeyDown={(event) => {
				if (event.target !== event.currentTarget) return;
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onSelect("agreement");
				}
			}}
			className="group/agreement relative -mx-3 px-3 outline-none"
		>
			<span
				aria-hidden="true"
				className={`pointer-events-none absolute -inset-y-1 inset-x-0 rounded-lg border transition ${
					active
						? "border-slate-300"
						: "border-transparent group-hover/agreement:border-slate-200 group-focus/agreement:border-slate-300"
				}`}
			/>
			<div className="relative">{children}</div>
		</div>
	);
}

function SignatureColumn({
	heading,
	name,
	at,
	imageUrl,
	imageScale = 1,
	imageOffsetX = 0,
	imageOffsetY = 0,
	large,
}: {
	heading: string;
	name: string | null;
	at: string | null;
	imageUrl?: string | null;
	/** Display multiplier the signer chose; 1 = base height. */
	imageScale?: number;
	/** Overlay offsets in base-height multiples; +x right, +y up. */
	imageOffsetX?: number;
	imageOffsetY?: number;
	large?: boolean;
}) {
	const base = large
		? SIGNATURE_BASE_HEIGHT_PX
		: SIGNATURE_COMPACT_BASE_HEIGHT_PX;
	const fieldHeight = large
		? SIGNATURE_FIELD_HEIGHT_PX
		: SIGNATURE_COMPACT_FIELD_HEIGHT_PX;
	const imageHeight = base * (imageScale || 1);
	return (
		<div>
			<p
				className={`font-semibold uppercase tracking-wide text-[#9ca3af] ${large ? "text-xs" : "text-[10px]"}`}
			>
				{heading}
			</p>
			{/* A signature field of FIXED height, exactly like the one you drop a
			    signature into in a PDF signer. The image is an absolutely
			    positioned overlay above the page content — resizing or moving it
			    changes nothing about the document's layout or length, and the two
			    columns' rules stay on one baseline no matter what either party
			    does. */}
			<div
				className="relative mt-1 border-b border-slate-300"
				style={{ height: fieldHeight }}
			>
				{imageUrl ? (
					<img
						src={imageUrl}
						alt={`${name ?? "Signature"} signature`}
						className="pointer-events-none absolute bottom-0 left-0 z-10 max-w-none object-contain"
						style={{
							height: imageHeight,
							transform: `translate(${imageOffsetX * base}px, ${-imageOffsetY * base}px)`,
						}}
					/>
				) : null}
			</div>
			<p className="mt-1 text-[#374151]">
				{name ? (
					<>
						{name}
						<br />
						<span
							className={`text-[#9ca3af] ${large ? "text-xs" : "text-[10px]"}`}
						>
							Signed {formatContractDate((at ?? "").slice(0, 10))}
						</span>
					</>
				) : (
					<span
						className={`text-[#9ca3af] ${large ? "text-xs" : "text-[10px]"}`}
					>
						Name / Signature / Date
					</span>
				)}
			</p>
		</div>
	);
}
