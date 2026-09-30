import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeftRight,
	FileText,
	History,
	Loader2,
	ShieldAlert,
	ShieldCheck,
	Sparkles,
	X,
} from "lucide-react";
import { useState } from "react";
import { ModalPortal } from "@/components/common/ModalPortal";
import { useToast } from "@/hooks/useToast";
import type { Contract } from "@/services/contract.service";
import {
	type ContractComparison,
	type ContractVersionEntry,
	contractHistoryService,
	formatDiffValue,
} from "@/services/contract-history.service";

type Tab = "changes" | "history";

const CAPACITY_LABEL: Record<string, string> = {
	client: "Client",
	consultant: "Consultant",
	talent: "Talent",
};

function shortDate(value: string | null | undefined): string {
	if (!value) return "—";
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return value;
	return parsed.toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

/**
 * Version history, negotiation revisions, the deterministic comparison and
 * the AI summary that sits on top of it. The comparison table is always the
 * authority; the summary only explains its rows.
 */
export function ContractHistoryPanel({
	contract,
	viewerId,
	initialTab = "history",
	onClose,
	onOpenVersion,
}: {
	contract: Contract;
	viewerId: string | undefined;
	initialTab?: Tab;
	onClose: () => void;
	onOpenVersion?: (contractId: string) => void;
}) {
	const [tab, setTab] = useState<Tab>(initialTab);
	const [compare, setCompare] = useState<{ a: string; b: string } | null>(null);
	const isSeat = contract.positions.some((seat) => seat.user_id === viewerId);

	return (
		<ModalPortal>
			<div className="fixed inset-0 z-80 flex justify-end">
				<button
					type="button"
					aria-label="Close history"
					onClick={onClose}
					className="absolute inset-0 bg-foreground/30 backdrop-blur-[1px]"
				/>
				<aside
					role="dialog"
					aria-modal="true"
					aria-label="Contract history"
					className="relative flex h-full w-full max-w-2xl flex-col border-l border-border bg-card shadow-2xl"
				>
					<header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
						<div className="flex items-center gap-2">
							<History className="h-4 w-4 text-primary" />
							<h2 className="text-sm font-semibold text-foreground">
								{compare ? "Compare versions" : "History"}
							</h2>
						</div>
						<button
							type="button"
							onClick={compare ? () => setCompare(null) : onClose}
							className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
							aria-label={compare ? "Back to history" : "Close"}
						>
							<X className="h-4 w-4" />
						</button>
					</header>
					{compare ? (
						<CompareView contractId={compare.a} otherId={compare.b} />
					) : (
						<>
							<div className="flex gap-1 border-b border-border px-4 py-2">
								{(
									[
										["history", "Versions"],
										...(isSeat ? [["changes", "Changes"]] : []),
									] as Array<[Tab, string]>
								).map(([key, label]) => (
									<button
										type="button"
										key={key}
										onClick={() => setTab(key)}
										className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
											tab === key
												? "bg-foreground text-background"
												: "text-muted-foreground hover:bg-muted"
										}`}
									>
										{label}
									</button>
								))}
							</div>
							<div className="min-h-0 flex-1 overflow-y-auto p-4">
								{tab === "history" ? (
									<VersionList
										contractId={contract.id}
										onCompare={(a, b) => setCompare({ a, b })}
										onOpenVersion={onOpenVersion}
									/>
								) : (
									<RevisionList contract={contract} />
								)}
							</div>
						</>
					)}
				</aside>
			</div>
		</ModalPortal>
	);
}

function VersionList({
	contractId,
	onCompare,
	onOpenVersion,
}: {
	contractId: string;
	onCompare: (a: string, b: string) => void;
	onOpenVersion?: (contractId: string) => void;
}) {
	const toast = useToast();
	const historyQuery = useQuery({
		queryKey: ["contract", contractId, "history"],
		queryFn: () => contractHistoryService.history(contractId),
	});
	const pdfMutation = useMutation({
		mutationFn: (id: string) => contractHistoryService.signedPdf(id),
		onSuccess: (pdf) => {
			if (!pdf.verified) {
				toast.error(
					"The stored agreement no longer matches its recorded fingerprint.",
				);
			}
			window.open(pdf.url, "_blank", "noopener");
		},
		onError: (error: Error) => toast.error(error.message),
	});

	if (historyQuery.isPending) {
		return (
			<div className="flex justify-center py-10">
				<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
			</div>
		);
	}
	if (historyQuery.isError) {
		return (
			<p className="text-sm text-destructive">{historyQuery.error.message}</p>
		);
	}
	const versions = historyQuery.data.versions;
	return (
		<ol className="space-y-2">
			{versions.map((entry, index) => {
				const previous = versions[index + 1];
				return (
					<VersionRow
						key={entry.id}
						entry={entry}
						previous={previous}
						onCompare={onCompare}
						onOpenVersion={onOpenVersion}
						onPdf={() => pdfMutation.mutate(entry.id)}
						pdfPending={
							pdfMutation.isPending && pdfMutation.variables === entry.id
						}
					/>
				);
			})}
		</ol>
	);
}

function VersionRow({
	entry,
	previous,
	onCompare,
	onOpenVersion,
	onPdf,
	pdfPending,
}: {
	entry: ContractVersionEntry;
	previous?: ContractVersionEntry;
	onCompare: (a: string, b: string) => void;
	onOpenVersion?: (contractId: string) => void;
	onPdf: () => void;
	pdfPending: boolean;
}) {
	const signedAt = entry.signatures
		.map((signature) => signature.signed_at)
		.filter((value): value is string => Boolean(value))
		.sort()
		.at(-1);
	const statusLabel =
		entry.status === "signed" || entry.status === "ended"
			? `Signed ${shortDate(signedAt)}`
			: entry.status === "draft"
				? entry.supersedes_contract_id
					? "Draft amendment"
					: "Draft"
				: entry.status === "sent"
					? "Awaiting signatures"
					: "Cancelled";
	return (
		<li className="rounded-lg border border-border p-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2">
					<span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-bold text-primary">
						v{entry.version}
					</span>
					<button
						type="button"
						onClick={() => onOpenVersion?.(entry.id)}
						className="truncate text-sm font-semibold text-foreground hover:underline"
					>
						{statusLabel}
					</button>
					{entry.status === "ended" && (
						<span className="text-[11px] text-muted-foreground">
							(superseded)
						</span>
					)}
				</div>
				<div className="flex items-center gap-1.5">
					{entry.snapshot && (
						<button
							type="button"
							onClick={onPdf}
							disabled={pdfPending}
							className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold hover:bg-muted disabled:opacity-50"
						>
							{pdfPending ? (
								<Loader2 className="h-3 w-3 animate-spin" />
							) : (
								<FileText className="h-3 w-3" />
							)}
							PDF
						</button>
					)}
					{previous && (
						<button
							type="button"
							onClick={() => onCompare(previous.id, entry.id)}
							className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold hover:bg-muted"
						>
							<ArrowLeftRight className="h-3 w-3" /> Compare with v
							{previous.version}
						</button>
					)}
				</div>
			</div>
			<p className="mt-1 text-xs text-muted-foreground">
				Effective {shortDate(entry.effective_from)}
				{entry.proposed_by_capacity
					? ` · proposed by ${entry.proposed_by_name ?? CAPACITY_LABEL[entry.proposed_by_capacity]} (${CAPACITY_LABEL[entry.proposed_by_capacity]})`
					: ""}
			</p>
			{entry.snapshot?.kind === "backfill" && (
				<p className="mt-1 text-[11px] text-muted-foreground">
					Snapshot taken on {shortDate(entry.snapshot.taken_at)}, after signing.
				</p>
			)}
		</li>
	);
}

function RevisionList({ contract }: { contract: Contract }) {
	const qc = useQueryClient();
	const toast = useToast();
	const revisionsQuery = useQuery({
		queryKey: ["contract", contract.id, "revisions"],
		queryFn: () => contractHistoryService.revisions(contract.id),
	});
	const reviewedMutation = useMutation({
		mutationFn: () =>
			contractHistoryService.markViewed(contract.id, contract.revision),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["contract", contract.id] });
			toast.success("Marked as reviewed");
		},
		onError: (error: Error) => toast.error(error.message),
	});
	if (revisionsQuery.isPending) {
		return (
			<div className="flex justify-center py-10">
				<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
			</div>
		);
	}
	if (revisionsQuery.isError) {
		return (
			<p className="text-sm text-destructive">{revisionsQuery.error.message}</p>
		);
	}
	const data = revisionsQuery.data;
	return (
		<div className="space-y-3">
			{data.unseen_changes && (
				<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
					<span>
						The other party changed this contract since you last reviewed it.
						The highlighted changes are new to you.
					</span>
					<button
						type="button"
						onClick={() => reviewedMutation.mutate()}
						disabled={reviewedMutation.isPending}
						className="rounded-md border border-amber-400/70 px-2.5 py-1 font-semibold hover:bg-amber-100 disabled:opacity-50 dark:hover:bg-amber-500/20"
					>
						I have reviewed these changes
					</button>
				</div>
			)}
			{data.revisions.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No changes since this version was created.
				</p>
			) : (
				data.revisions.map((revision) => (
					<div
						key={revision.revision}
						className={`rounded-lg border p-3 ${
							revision.unseen
								? "border-amber-400/70 bg-amber-50/60 dark:bg-amber-500/5"
								: "border-border"
						}`}
					>
						<p className="text-xs font-semibold text-foreground">
							Revision {revision.revision} · changed by{" "}
							{revision.author_name ?? "a party"} ·{" "}
							{shortDate(revision.created_at)}
						</p>
						<table className="mt-2 w-full text-xs">
							<tbody>
								{revision.changes.map((change) => (
									<tr key={change.field} className="border-t border-border/60">
										<td className="py-1 pr-2 font-medium text-foreground">
											{change.label}
										</td>
										<td className="py-1 pr-2 text-muted-foreground line-through">
											{formatDiffValue(change.before)}
										</td>
										<td className="py-1 text-foreground">
											{formatDiffValue(change.after)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				))
			)}
		</div>
	);
}

function CompareView({
	contractId,
	otherId,
}: {
	contractId: string;
	otherId: string;
}) {
	const compareQuery = useQuery({
		queryKey: ["contract", contractId, "compare", otherId],
		queryFn: () => contractHistoryService.compare(contractId, otherId),
	});
	const summaryMutation = useMutation({
		mutationFn: () => contractHistoryService.summary(contractId, otherId),
	});
	if (compareQuery.isPending) {
		return (
			<div className="flex flex-1 justify-center py-10">
				<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
			</div>
		);
	}
	if (compareQuery.isError) {
		return (
			<p className="p-4 text-sm text-destructive">
				{compareQuery.error.message}
			</p>
		);
	}
	const comparison = compareQuery.data;
	const rowCount =
		comparison.diff.fields.length +
		comparison.diff.services.length +
		comparison.diff.clauses.length;
	return (
		<div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
			<section className="rounded-lg border border-primary/30 bg-primary/5 p-3">
				<div className="flex items-center justify-between gap-2">
					<p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary">
						<Sparkles className="h-3.5 w-3.5" /> Insights
					</p>
					{!summaryMutation.data && (
						<button
							type="button"
							onClick={() => summaryMutation.mutate()}
							disabled={summaryMutation.isPending || rowCount === 0}
							className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground disabled:opacity-50"
						>
							{summaryMutation.isPending && (
								<Loader2 className="h-3 w-3 animate-spin" />
							)}
							Explain these changes
						</button>
					)}
				</div>
				{summaryMutation.isError && (
					<p className="mt-2 text-xs text-destructive">
						{summaryMutation.error.message}
					</p>
				)}
				{summaryMutation.data && (
					<SummaryBody summary={summaryMutation.data} comparison={comparison} />
				)}
				{!summaryMutation.data && !summaryMutation.isError && (
					<p className="mt-2 text-xs text-muted-foreground">
						A plain-language explanation of the table below, written for your
						side of the agreement.
					</p>
				)}
			</section>
			<ComparisonTable comparison={comparison} />
		</div>
	);
}

function SummaryBody({
	summary,
	comparison,
}: {
	summary: Awaited<ReturnType<typeof contractHistoryService.summary>>;
	comparison: ContractComparison;
}) {
	const labels = new Map<string, string>([
		...comparison.diff.fields.map((row) => [row.id, row.label] as const),
		...comparison.diff.services.map(
			(row) => [row.id, `Service: ${row.name}`] as const,
		),
		...comparison.diff.clauses.map(
			(row) => [row.id, `Clause: ${row.title}`] as const,
		),
	]);
	return (
		<div className="mt-2 space-y-2 text-sm text-foreground">
			{summary.headline && <p className="font-semibold">{summary.headline}</p>}
			<ul className="list-disc space-y-1 pl-5">
				{summary.bullets.map((bullet) => (
					<li key={bullet.text}>
						{bullet.text}{" "}
						{bullet.row_ids.map((id) => (
							<a
								key={id}
								href={`#diff-${id}`}
								className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground hover:text-foreground"
							>
								{labels.get(id) ?? id}
							</a>
						))}
					</li>
				))}
			</ul>
			{summary.for_you && (
				<p className="text-sm">
					<span className="font-semibold">What this means for you: </span>
					{summary.for_you}
				</p>
			)}
			<p className="text-[11px] text-muted-foreground">{summary.disclaimer}</p>
		</div>
	);
}

function ComparisonTable({ comparison }: { comparison: ContractComparison }) {
	const { fields, services, clauses } = comparison.diff;
	if (fields.length + services.length + clauses.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				v{comparison.from.version} and v{comparison.to.version} have the same
				terms.
			</p>
		);
	}
	return (
		<section className="space-y-4">
			{(fields.length > 0 || services.length > 0) && (
				<table className="w-full text-xs">
					<thead>
						<tr className="text-left text-muted-foreground">
							<th className="py-1 pr-2 font-medium">Term</th>
							<th className="py-1 pr-2 font-medium">
								v{comparison.from.version}
							</th>
							<th className="py-1 font-medium">v{comparison.to.version}</th>
						</tr>
					</thead>
					<tbody>
						{fields.map((row) => (
							<tr
								key={row.id}
								id={`diff-${row.id}`}
								className="border-t border-border"
							>
								<td className="py-1.5 pr-2 font-medium text-foreground">
									{row.label}
								</td>
								<td className="py-1.5 pr-2 text-muted-foreground">
									{formatDiffValue(row.before)}
								</td>
								<td className="py-1.5 text-foreground">
									{formatDiffValue(row.after)}
								</td>
							</tr>
						))}
						{services.map((row) => (
							<tr
								key={row.id}
								id={`diff-${row.id}`}
								className="border-t border-border"
							>
								<td className="py-1.5 pr-2 font-medium text-foreground">
									Service: {row.name} ({row.change})
								</td>
								<td className="py-1.5 pr-2 text-muted-foreground">
									{row.before ? `${row.before.unit_rate}` : "—"}
								</td>
								<td className="py-1.5 text-foreground">
									{row.after ? `${row.after.unit_rate}` : "—"}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
			{clauses.map((row) => (
				<div
					key={row.id}
					id={`diff-${row.id}`}
					className="rounded-lg border border-border p-3 text-xs"
				>
					<p className="font-semibold text-foreground">
						{row.title}{" "}
						<span className="font-normal text-muted-foreground">
							({row.change})
						</span>
					</p>
					{row.before && (
						<p className="mt-1 whitespace-pre-wrap text-muted-foreground line-through">
							{row.before}
						</p>
					)}
					{row.after && (
						<p className="mt-1 whitespace-pre-wrap text-foreground">
							{row.after}
						</p>
					)}
				</div>
			))}
		</section>
	);
}

/** The "frozen copy" badge for a signed contract's header. */
export function FrozenBadge({ contract }: { contract: Contract }) {
	if (!contract.signed_pdf_sha256) return null;
	const backfill = contract.signed_snapshot_kind === "backfill";
	const Icon = backfill ? ShieldAlert : ShieldCheck;
	return (
		<span
			title={`Frozen at ${contract.signed_snapshot_taken_at ?? "signing"} · sha256 ${contract.signed_pdf_sha256.slice(0, 12)}…`}
			className="hidden items-center gap-1 rounded-full border border-emerald-400/50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 md:inline-flex dark:text-emerald-300"
		>
			<Icon className="h-3 w-3" />
			{backfill ? "Snapshot after signing" : "Frozen copy"}
		</span>
	);
}
