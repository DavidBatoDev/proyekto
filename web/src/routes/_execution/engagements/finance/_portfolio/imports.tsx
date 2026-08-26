import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	FileText,
	FolderKanban,
	Image as ImageIcon,
	Loader2,
	Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { AppEmptyState } from "@/components/common/AppPrimitives";
import {
	type FinanceSearchState,
	validateFinanceSharedSearch,
} from "@/components/finance/portfolio/financeSearch";
import { useToast } from "@/hooks/useToast";
import {
	type FinanceDocument,
	type FinanceDocumentKind,
	financeImportsService,
} from "@/services/financeImports.service";

/**
 * Recording billing that happened outside Proyekto.
 *
 * Project-scoped on purpose: an imported invoice belongs to one project's
 * ledger, and the picker in the toolbar above is how you say which. Until a
 * project is chosen there is nothing to file anything under.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/_portfolio/imports",
)({
	validateSearch: (search: Record<string, unknown>): FinanceSearchState =>
		validateFinanceSharedSearch(search),
	component: FinanceImportsPage,
});

const KINDS: Array<{ kind: FinanceDocumentKind; label: string; hint: string }> =
	[
		{
			kind: "invoice",
			label: "Invoice",
			hint: "A PDF you already sent the client",
		},
		{
			kind: "payment_proof",
			label: "Proof of payment",
			hint: "A bank record or transfer screenshot",
		},
	];

function FinanceImportsPage() {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const toast = useToast();
	const qc = useQueryClient();
	const projectId = search.projectId;

	const [kind, setKind] = useState<FinanceDocumentKind>("invoice");
	const fileInputRef = useRef<HTMLInputElement>(null);

	const documentsQuery = useQuery({
		queryKey: ["finance-import", "documents", projectId],
		queryFn: () => financeImportsService.list(projectId ?? ""),
		enabled: Boolean(projectId),
	});

	const uploadMutation = useMutation({
		mutationFn: (file: File) =>
			financeImportsService.upload(projectId ?? "", kind, file),
		onSuccess: (document) => {
			void qc.invalidateQueries({ queryKey: ["finance-import"] });
			toast.success(`${document.file_name} uploaded`);
			// An invoice is uploaded in order to be recorded, so the workspace opens
			// straight away; a bank record is evidence to attach later and stays put.
			if (document.kind === "invoice") {
				void navigate({
					to: "/engagements/finance/imports/$documentId",
					params: { documentId: document.id },
				});
			}
		},
		onError: (error: Error) => toast.error(error.message),
	});

	if (!projectId) {
		return (
			<AppEmptyState
				icon={FolderKanban}
				title="Choose a project first"
				description="Imported invoices belong to one project's ledger. Pick a project in the filter bar above to record its past billing."
			/>
		);
	}

	const documents = documentsQuery.data ?? [];
	const invoices = documents.filter((document) => document.kind === "invoice");
	const proofs = documents.filter(
		(document) => document.kind === "payment_proof",
	);

	return (
		<div className="space-y-5">
			<section className="rounded-xl border border-border bg-card p-4">
				<h2 className="text-sm font-semibold text-foreground">
					Record past billing
				</h2>
				<p className="mt-0.5 text-xs text-muted-foreground">
					Upload an invoice that was issued outside Proyekto, snip its figures
					from the document itself, and it joins this project's overview,
					ageing, and totals.
				</p>

				<div className="mt-3 flex flex-wrap items-center gap-2">
					{KINDS.map((entry) => (
						<button
							key={entry.kind}
							type="button"
							onClick={() => setKind(entry.kind)}
							aria-pressed={kind === entry.kind}
							className={`rounded-lg border px-3 py-1.5 text-left text-xs transition-colors ${
								kind === entry.kind
									? "border-primary bg-primary/10 text-foreground"
									: "border-border text-muted-foreground hover:bg-muted"
							}`}
						>
							<span className="block font-semibold">{entry.label}</span>
							<span className="block text-[11px]">{entry.hint}</span>
						</button>
					))}

					<button
						type="button"
						onClick={() => fileInputRef.current?.click()}
						disabled={uploadMutation.isPending}
						className="app-cta ml-auto inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
					>
						{uploadMutation.isPending ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Upload className="h-4 w-4" />
						)}
						Upload {kind === "invoice" ? "invoice" : "proof"}
					</button>
					<input
						ref={fileInputRef}
						type="file"
						accept="application/pdf,image/png,image/jpeg,image/webp"
						className="hidden"
						onChange={(event) => {
							const file = event.target.files?.[0];
							if (file) uploadMutation.mutate(file);
							event.target.value = "";
						}}
					/>
				</div>
			</section>

			{documentsQuery.isPending ? (
				<div className="flex justify-center py-16">
					<Loader2 className="h-5 w-5 animate-spin text-primary" />
				</div>
			) : documents.length === 0 ? (
				<AppEmptyState
					icon={FileText}
					title="No documents yet"
					description="Upload the invoice PDFs and bank records for this project's past billing to record it here."
				/>
			) : (
				<>
					<DocumentList
						title="Invoices"
						subtitle="Open one to snip its figures and record it."
						documents={invoices}
						onOpen={(documentId) =>
							void navigate({
								to: "/engagements/finance/imports/$documentId",
								params: { documentId },
							})
						}
					/>
					<DocumentList
						title="Proof of payment"
						subtitle="Attach these to a payment while recording an invoice."
						documents={proofs}
					/>
				</>
			)}
		</div>
	);
}

function DocumentList({
	title,
	subtitle,
	documents,
	onOpen,
}: {
	title: string;
	subtitle: string;
	documents: FinanceDocument[];
	onOpen?: (documentId: string) => void;
}) {
	if (documents.length === 0) return null;

	return (
		<section>
			<h2 className="text-sm font-semibold text-foreground">{title}</h2>
			<p className="mb-2 mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
			<ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
				{documents.map((document) => {
					const Icon =
						document.mime_type === "application/pdf" ? FileText : ImageIcon;
					const row = (
						<span className="flex min-w-0 flex-1 items-center gap-3">
							<Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
							<span className="min-w-0">
								<span className="block truncate text-sm text-foreground">
									{document.file_name}
								</span>
								<span className="block text-[11px] text-muted-foreground">
									{new Date(document.created_at).toLocaleDateString()} ·{" "}
									{Math.round(document.size_bytes / 1024)} KB
									{document.extraction_status === "ready" && " · read"}
								</span>
							</span>
						</span>
					);

					return (
						<li key={document.id}>
							{onOpen ? (
								<button
									type="button"
									onClick={() => onOpen(document.id)}
									className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
								>
									{row}
								</button>
							) : (
								<div className="flex items-center gap-3 px-4 py-3">{row}</div>
							)}
						</li>
					);
				})}
			</ul>
		</section>
	);
}
