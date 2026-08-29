import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { BriefEditor } from "@/components/brief/BriefEditor";
import { BackLink } from "@/components/common/BackLink";
import { useBriefComposer } from "@/hooks/useBriefComposer";
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";
import { commitBrief } from "@/lib/briefCommit";
import { type BriefDraft, toDraft } from "@/lib/briefDraft";
import { postingsService } from "@/services/postings.service";

/**
 * The editor for a brief that already exists.
 *
 * A data shell: it loads the row, hands the editor its values, and owns the two
 * writes. Everything visual lives in `BriefEditor`, which `/brief/new` renders
 * with no row behind it at all.
 */
export const Route = createFileRoute("/_execution/brief/$briefId/edit")({
	component: BriefEditorPage,
});

function BriefEditorPage() {
	const { briefId } = Route.useParams();
	const navigate = useNavigate();
	const toast = useToast();
	const confirm = useConfirm();
	const qc = useQueryClient();

	const briefQuery = useQuery({
		queryKey: ["posting", briefId] as const,
		queryFn: () => postingsService.get(briefId),
	});

	const [seed, setSeed] = useState<BriefDraft | null>(null);
	const [saving, setSaving] = useState<"draft" | "publish" | null>(null);
	const [deleting, setDeleting] = useState(false);

	// Seed once per loaded brief. Re-seeding on every refetch would throw away
	// whatever the author has typed since.
	useEffect(() => {
		if (!briefQuery.data) return;
		setSeed((current) => current ?? toDraft(briefQuery.data));
	}, [briefQuery.data]);

	if (briefQuery.isPending || (!seed && !briefQuery.isError)) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background">
				<Loader2 className="h-8 w-8 animate-spin text-primary" />
			</div>
		);
	}

	if (briefQuery.isError || !briefQuery.data || !seed) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
				<div>
					<p className="text-base font-semibold text-foreground">
						Brief not found
					</p>
					<p className="mt-1 text-sm text-muted-foreground">
						It may have been deleted, or it belongs to somebody else.
					</p>
				</div>
			</div>
		);
	}

	return (
		<LoadedEditor
			key={briefId}
			briefId={briefId}
			seed={seed}
			brief={briefQuery.data}
			saving={saving}
			setSaving={setSaving}
			deleting={deleting}
			setDeleting={setDeleting}
			navigate={navigate}
			toast={toast}
			confirm={confirm}
			qc={qc}
		/>
	);
}

/**
 * Split out so the composer hook is only mounted once the brief has loaded —
 * its initial state is the loaded row, and a hook cannot be seeded twice.
 */
function LoadedEditor({
	briefId,
	seed,
	brief,
	saving,
	setSaving,
	deleting,
	setDeleting,
	navigate,
	toast,
	confirm,
	qc,
}: {
	briefId: string;
	seed: BriefDraft;
	brief: Awaited<ReturnType<typeof postingsService.get>>;
	saving: "draft" | "publish" | null;
	setSaving: (next: "draft" | "publish" | null) => void;
	deleting: boolean;
	setDeleting: (next: boolean) => void;
	navigate: ReturnType<typeof useNavigate>;
	toast: ReturnType<typeof useToast>;
	confirm: ReturnType<typeof useConfirm>;
	qc: ReturnType<typeof useQueryClient>;
}) {
	const composer = useBriefComposer({
		// The row exists, so there is nothing to rescue from a refresh: a reload
		// re-reads it from the server.
		persist: false,
		briefId,
		initialDraft: seed,
		initialAttachments: brief.attachments,
	});

	const commit = async (publish: boolean) => {
		setSaving(publish ? "publish" : "draft");
		try {
			const result = await commitBrief({
				briefId,
				draft: composer.draftRef.current,
				pending: composer.pendingRef.current,
				existing: composer.attachments,
			});
			composer.setAttachments(result.attachments);
			composer.keepPending(result.remaining.map((file) => file.id));

			if (result.error) {
				toast.error(
					`Saved, but ${result.remaining.length} ${
						result.remaining.length === 1 ? "file" : "files"
					} could not be uploaded. Try again.`,
				);
				return;
			}

			void qc.invalidateQueries({ queryKey: ["postings", "mine"] });
			if (!publish) {
				void qc.invalidateQueries({ queryKey: ["posting", briefId] });
				toast.success("Draft saved.");
				return;
			}

			await postingsService.publish(briefId);
			toast.success("Your brief is live. Consultants can now respond.");
			// The detail cache has to be awaited, not fired and forgotten: the very
			// next line navigates to the page that reads it, and a stale entry
			// renders the brief we just published as a draft.
			await qc.invalidateQueries({ queryKey: ["posting", briefId] });
			await navigate({ to: "/brief/$briefId", params: { briefId } });
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to save the brief.",
			);
		} finally {
			setSaving(null);
		}
	};

	const handleDelete = async () => {
		const ok = await confirm({
			title: "Delete this brief?",
			message:
				brief.status === "published"
					? "It is live right now. Deleting it removes the brief, its files and every proposal consultants have sent."
					: "This removes the brief and any files attached to it. It cannot be undone.",
			confirmLabel: "Delete brief",
			tone: "danger",
		});
		if (!ok) return;
		setDeleting(true);
		try {
			await postingsService.remove(briefId);
			qc.removeQueries({ queryKey: ["posting", briefId] });
			void qc.invalidateQueries({ queryKey: ["postings", "mine"] });
			toast.success("Brief deleted.");
			await navigate({ to: "/dashboard" });
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to delete the brief.",
			);
		} finally {
			setDeleting(false);
		}
	};

	return (
		<BriefEditor
			briefId={briefId}
			draft={composer.draft}
			onPatch={composer.patch}
			attachments={composer.attachments}
			onAttachmentsChange={composer.setAttachments}
			pending={composer.pending}
			onPickFiles={(files) => void composer.addFiles(files)}
			onRemovePending={composer.removePending}
			currency={brief.currency}
			status={brief.status}
			busy={saving !== null || deleting}
			saving={saving === "draft"}
			publishing={saving === "publish"}
			headerLeft={<BackLink fallback={{ to: "/dashboard" }} />}
			headerExtra={
				<button
					type="button"
					onClick={() => void handleDelete()}
					disabled={deleting}
					className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-destructive disabled:opacity-60"
				>
					{deleting ? "Deleting…" : "Delete"}
				</button>
			}
			onSave={() => void commit(false)}
			onPublish={() => void commit(true)}
		/>
	);
}
