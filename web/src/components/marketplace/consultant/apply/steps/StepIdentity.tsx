import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck, Trash2, UploadCloud } from "lucide-react";
import { useState } from "react";
import { GoLiveCallout } from "@/components/marketplace/wizard/GoLiveForm";
import { readError } from "@/components/marketplace/wizard/helpers";
import { IdentityDocumentModal } from "@/components/profile/IdentityDocumentModal";
import { useToast } from "@/hooks/useToast";
import {
	profileService,
	type UserIdentityDocument,
} from "@/services/profile.service";
import { uploadService } from "@/services/upload.service";

const DOC_TYPE_LABELS: Record<string, string> = {
	passport: "Passport",
	national_id: "National ID",
	drivers_license: "Driver's License",
	other: "Other official document",
};

/**
 * Step 4: identity, actually required this time.
 *
 * The old wizard's copy called the ID mandatory while its Next button let
 * anyone walk past it. The requirement now lives in the server's eligibility
 * check, and this step exists so people meet it where it is explained rather
 * than as a surprise refusal on the review step.
 *
 * Uploads persist immediately (private bucket + user_identity_documents row);
 * abandoning the wizard keeps the document, which is correct — it belongs to
 * the profile's vetting record, not to this draft.
 */
export function StepIdentity({
	documents,
	profileKey,
}: {
	documents: UserIdentityDocument[];
	/** Query key of the full profile, invalidated after every change. */
	profileKey: readonly unknown[];
}) {
	const [modalOpen, setModalOpen] = useState(false);
	const queryClient = useQueryClient();
	const toast = useToast();
	const refresh = () => queryClient.invalidateQueries({ queryKey: profileKey });

	const addDocument = useMutation({
		mutationFn: async ({
			type,
			file,
		}: {
			type: UserIdentityDocument["type"];
			file: File;
		}) => {
			const storagePath = await uploadService.upload(
				"identity_documents",
				file,
			);
			return profileService.addIdentityDocument({
				type,
				storage_path: storagePath,
			});
		},
		onSuccess: () => {
			setModalOpen(false);
			void refresh();
		},
		onError: (cause) => toast.error(readError(cause)),
	});

	const deleteDocument = useMutation({
		mutationFn: (id: string) => profileService.deleteIdentityDocument(id),
		onSuccess: () => void refresh(),
		onError: (cause) => toast.error(readError(cause)),
	});

	return (
		<div className="space-y-4">
			<section className="rounded-2xl border border-border bg-card p-5">
				<h3 className="text-[15px] font-semibold text-foreground">
					Verify your identity
				</h3>
				<p className="mt-1 mb-4 text-sm text-muted-foreground">
					Upload one government-issued photo ID. It is stored in a private
					bucket, visible only to the review team, and you cannot submit your
					application without it — verified identity is what "vetted consultant"
					means to clients.
				</p>

				{documents.length > 0 && (
					<ul className="mb-4 space-y-2">
						{documents.map((doc) => (
							<li
								key={doc.id}
								className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5"
							>
								<span
									className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
										doc.is_verified
											? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
											: "bg-muted text-muted-foreground"
									}`}
								>
									<ShieldCheck className="h-4.5 w-4.5" />
								</span>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-sm font-medium text-foreground">
										{DOC_TYPE_LABELS[doc.type] ?? doc.type}
									</span>
									<span className="block text-xs text-muted-foreground">
										{doc.is_verified
											? "Verified by the review team"
											: "Uploaded — verified during review"}
									</span>
								</span>
								<button
									type="button"
									onClick={() => deleteDocument.mutate(doc.id)}
									disabled={deleteDocument.isPending}
									aria-label={`Remove ${DOC_TYPE_LABELS[doc.type] ?? doc.type}`}
									className="shrink-0 cursor-pointer rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-40"
								>
									{deleteDocument.isPending ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										<Trash2 className="h-4 w-4" />
									)}
								</button>
							</li>
						))}
					</ul>
				)}

				<button
					type="button"
					onClick={() => setModalOpen(true)}
					className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-input px-4 py-6 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
				>
					<UploadCloud className="h-4.5 w-4.5" />
					{documents.length > 0
						? "Add another document"
						: "Upload an identity document"}
				</button>
			</section>

			{documents.length === 0 && (
				<GoLiveCallout tone="caution">
					An identity document is required before you can submit.
				</GoLiveCallout>
			)}

			<IdentityDocumentModal
				isOpen={modalOpen}
				onClose={() => setModalOpen(false)}
				onSave={(payload, file) =>
					addDocument.mutate({ type: payload.type, file })
				}
				isSaving={addDocument.isPending}
			/>
		</div>
	);
}
