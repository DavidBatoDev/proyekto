import { Maximize2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
	type BillingMode,
	formatContractDate,
	formatMoney,
} from "@/lib/contract-term";
import type {
	Contract,
	ContractClause,
	ContractService,
} from "@/services/contract.service";

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
export interface PreviewParties {
	provider_name: string;
	provider_address: string;
	provider_email?: string | null;
	client_name: string;
	client_contact_name: string;
	client_address: string;
}

/** The subset of commercial terms the document shows, fed live from the editor. */
export interface PreviewTerms {
	currency: string;
	billing_mode: BillingMode;
	recurring_fee: string;
	client_hourly_rate: string;
	service_description: string;
	payment_method: string;
	due_days: string;
}

function renderClause(body: string, provider: string, client: string): string {
	return body
		.replaceAll("{{provider}}", provider || "the Service Provider")
		.replaceAll("{{client}}", client || "the Client");
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
	return `${formatMoney(terms.currency, num(terms.recurring_fee))} / period + overage`;
}

export function ContractDocumentPreview({
	contract,
	parties,
	terms,
}: {
	contract: Contract;
	parties: PreviewParties;
	terms: PreviewTerms;
}) {
	const [expanded, setExpanded] = useState(false);

	return (
		<>
			<div className="overflow-hidden rounded-xl border border-border shadow-sm">
				<div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
					<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
						Live preview
					</p>
					<button
						type="button"
						onClick={() => setExpanded(true)}
						className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-primary transition hover:bg-primary/10"
					>
						<Maximize2 className="h-3 w-3" />
						Expand
					</button>
				</div>
				<div className="max-h-[75vh] overflow-y-auto">
					<PaperDocument contract={contract} parties={parties} terms={terms} />
				</div>
			</div>

			{expanded && (
				<ExpandedPreview onClose={() => setExpanded(false)}>
					<PaperDocument
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

function PaperDocument({
	contract,
	parties,
	terms,
	large,
}: {
	contract: Contract;
	parties: PreviewParties;
	terms: PreviewTerms;
	large?: boolean;
}) {
	const provider = parties.provider_name.trim() || "Service Provider";
	const client = parties.client_name.trim() || "Client";

	const termRows: Array<{ label: string; value: string }> = [
		{ label: "Billing", value: billingLine(terms) },
		{ label: "Currency", value: terms.currency || "—" },
		{
			label: "Service period",
			value: `${formatContractDate(contract.service_start_date)} – ${formatContractDate(contract.service_end_date)}`,
		},
		{
			label: "Payment terms",
			value: terms.due_days ? `Net ${terms.due_days} days` : "—",
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
			className={`bg-white text-slate-700 ${
				large
					? "px-8 py-8 text-sm leading-relaxed"
					: "px-5 py-5 text-[12px] leading-relaxed"
			}`}
		>
			{/* Provider header */}
			<div className="text-right">
				<p
					className={`font-bold uppercase tracking-wide text-slate-900 ${large ? "text-lg" : "text-sm"}`}
				>
					{provider}
				</p>
				{parties.provider_email && (
					<p className={`text-slate-400 ${large ? "text-xs" : "text-[10px]"}`}>
						{parties.provider_email}
					</p>
				)}
			</div>

			<h1
				className={`mt-5 text-center font-bold text-[#1f3a93] ${large ? "text-2xl" : "text-lg"}`}
			>
				Service Agreement
			</h1>
			{contract.contract_number && (
				<p
					className={`mt-0.5 text-center text-slate-400 ${large ? "text-xs" : "text-[10px]"}`}
				>
					#{contract.contract_number}
				</p>
			)}

			{/* Parties */}
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

			{/* Commercial terms */}
			<Section title="Commercial Terms" large={large}>
				<dl className="mt-1 space-y-1">
					{termRows.map((row) => (
						<div key={row.label} className="flex gap-3">
							<dt
								className={`shrink-0 text-slate-400 ${large ? "w-36" : "w-28"}`}
							>
								{row.label}
							</dt>
							<dd className="font-medium text-slate-800">{row.value}</dd>
						</div>
					))}
				</dl>
			</Section>

			{/* Services */}
			{contract.services.length > 0 && (
				<Section title="Services" large={large}>
					<ul className="mt-1 space-y-0.5">
						{contract.services.map((service: ContractService) => (
							<li key={service.id} className="flex justify-between gap-3">
								<span className="text-slate-700">
									{service.name || "Untitled service"}
								</span>
								<span className="tabular-nums text-slate-500">
									{formatMoney(terms.currency, service.unit_rate)}
									{service.unit ? ` / ${service.unit}` : ""}
								</span>
							</li>
						))}
					</ul>
				</Section>
			)}

			{/* Numbered clauses */}
			{contract.clauses.map((clause: ContractClause, index: number) => (
				<Section
					key={clause.key}
					title={`${index + 1}. ${clause.title}`}
					large={large}
				>
					<p className="mt-1 whitespace-pre-wrap text-slate-600">
						{renderClause(clause.body, provider, client)}
					</p>
				</Section>
			))}

			{/* Signatures */}
			<Section
				title={`${contract.clauses.length + 1}. Signature`}
				large={large}
			>
				<div className="mt-2 grid grid-cols-2 gap-4">
					<SignatureColumn
						heading={`For ${client}`}
						name={contract.signed_by_client_name}
						at={contract.signed_by_client_at}
						imageUrl={contract.signed_by_client_signature_url}
						large={large}
					/>
					<SignatureColumn
						heading={`For ${provider}`}
						name={contract.signed_by_consultant_name}
						at={contract.signed_by_consultant_at}
						imageUrl={contract.signed_by_consultant_signature_url}
						large={large}
					/>
				</div>
			</Section>
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
				className={`font-semibold uppercase tracking-wide text-slate-400 ${large ? "text-xs" : "text-[10px]"}`}
			>
				{heading}
			</p>
			<p className="mt-0.5 font-semibold text-slate-900">{name}</p>
			{contact && contact !== name && (
				<p className="text-slate-500">Attn: {contact}</p>
			)}
			{address && <p className="text-slate-500">{address}</p>}
		</div>
	);
}

function Section({
	title,
	large,
	children,
}: {
	title: string;
	large?: boolean;
	children: React.ReactNode;
}) {
	return (
		<div className="mt-4">
			<p
				className={`font-bold text-[#1f3a93] ${large ? "text-sm" : "text-[11px]"}`}
			>
				{title}
			</p>
			{children}
		</div>
	);
}

function SignatureColumn({
	heading,
	name,
	at,
	imageUrl,
	large,
}: {
	heading: string;
	name: string | null;
	at: string | null;
	imageUrl?: string | null;
	large?: boolean;
}) {
	return (
		<div>
			<p
				className={`font-semibold uppercase tracking-wide text-slate-400 ${large ? "text-xs" : "text-[10px]"}`}
			>
				{heading}
			</p>
			<div
				className={`mt-1 flex items-end border-b border-slate-300 ${large ? "h-16" : "h-12"}`}
			>
				{imageUrl ? (
					<img
						src={imageUrl}
						alt={`${name ?? "Signature"} signature`}
						className={`object-contain ${large ? "max-h-14" : "max-h-11"}`}
					/>
				) : null}
			</div>
			<p className="mt-1 text-slate-700">
				{name ? (
					<>
						{name}
						<br />
						<span
							className={`text-slate-400 ${large ? "text-xs" : "text-[10px]"}`}
						>
							Signed {formatContractDate((at ?? "").slice(0, 10))}
						</span>
					</>
				) : (
					<span
						className={`text-slate-400 ${large ? "text-xs" : "text-[10px]"}`}
					>
						Name / Signature / Date
					</span>
				)}
			</p>
		</div>
	);
}
