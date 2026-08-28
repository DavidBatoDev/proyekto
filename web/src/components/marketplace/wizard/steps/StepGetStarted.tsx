import { FileText, Loader2, PencilLine, Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { ImportedProfile } from "@/services/profileImport.service";
import { profileImportService } from "@/services/profileImport.service";
import { GoLiveCallout } from "../GoLiveForm";
import type { ImportPath } from "../profileDraft";

/**
 * Step 1: how do you want to build this?
 *
 * The import panel appears inside the card once it is chosen, rather than on a
 * separate screen — the choice and the thing it unlocks stay in one place, the
 * pattern VideoProviderPicker already uses.
 */
export function StepGetStarted({
	path,
	onChoosePath,
	onImported,
}: {
	path: ImportPath | null;
	onChoosePath: (path: ImportPath) => void;
	onImported: (imported: ImportedProfile) => void;
}) {
	return (
		<div className="space-y-4">
			<PathCard
				selected={path === "import"}
				onSelect={() => onChoosePath("import")}
				icon={<Upload className="h-5 w-5" />}
				title="Import from LinkedIn or a CV"
				hint="Fastest — we read your roles, education and skills, then you check them."
				badge="Recommended"
			>
				<ImportPanel onImported={onImported} />
			</PathCard>

			<PathCard
				selected={path === "manual"}
				onSelect={() => onChoosePath("manual")}
				icon={<PencilLine className="h-5 w-5" />}
				title="Fill it in myself"
				hint="Start from a blank profile and type everything in."
			/>
		</div>
	);
}

function PathCard({
	selected,
	onSelect,
	icon,
	title,
	hint,
	badge,
	children,
}: {
	selected: boolean;
	onSelect: () => void;
	icon: React.ReactNode;
	title: string;
	hint: string;
	badge?: string;
	children?: React.ReactNode;
}) {
	return (
		<div
			className={`rounded-2xl border transition-colors ${
				selected
					? "border-primary bg-primary/5"
					: "border-border bg-card hover:border-primary/50"
			}`}
		>
			<button
				type="button"
				onClick={onSelect}
				aria-pressed={selected}
				className="flex w-full cursor-pointer items-start gap-4 p-5 text-left"
			>
				<span
					className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
						selected
							? "bg-primary text-primary-foreground"
							: "bg-muted text-muted-foreground"
					}`}
				>
					{icon}
				</span>
				<span className="min-w-0 flex-1">
					<span className="flex flex-wrap items-center gap-2">
						<span className="text-[15px] font-semibold text-foreground">
							{title}
						</span>
						{badge && (
							<span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
								{badge}
							</span>
						)}
					</span>
					<span className="mt-1 block text-sm text-muted-foreground">
						{hint}
					</span>
				</span>
			</button>

			{selected && children && (
				<div className="border-t border-border/60 p-5 pt-4">{children}</div>
			)}
		</div>
	);
}

function ImportPanel({
	onImported,
}: {
	onImported: (imported: ImportedProfile) => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [dragging, setDragging] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [fileName, setFileName] = useState<string | null>(null);

	const handleFile = async (file: File | undefined) => {
		if (!file) return;
		setError(null);
		if (file.type !== "application/pdf") {
			setError("That needs to be a PDF.");
			return;
		}
		if (file.size > 10 * 1024 * 1024) {
			setError("That file is larger than 10 MB.");
			return;
		}
		setFileName(file.name);
		setBusy(true);
		try {
			onImported(await profileImportService.parse(file));
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "We could not read that file. You can still fill things in yourself.",
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="space-y-4">
			<ol className="space-y-2 text-sm text-muted-foreground">
				{[
					"Go to your profile on LinkedIn",
					"Open the Resources menu",
					"Choose Save to PDF",
				].map((instruction, index) => (
					<li key={instruction} className="flex items-center gap-3">
						<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
							{index + 1}
						</span>
						{instruction}
					</li>
				))}
			</ol>

			<button
				type="button"
				onClick={() => inputRef.current?.click()}
				onDragOver={(event) => {
					event.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={(event) => {
					event.preventDefault();
					setDragging(false);
					void handleFile(event.dataTransfer.files?.[0]);
				}}
				disabled={busy}
				// The panel behind this already carries a primary tint, so a plain
				// `border-border` dashed edge disappears into it. An explicit
				// background plus a stronger edge keeps the drop target readable.
				className={`flex w-full cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 transition-colors ${
					dragging
						? "border-primary bg-primary/10"
						: "border-muted-foreground/40 bg-background/70 hover:border-primary/60 hover:bg-background"
				} disabled:cursor-not-allowed disabled:opacity-70`}
			>
				{busy ? (
					<>
						<Loader2 className="h-6 w-6 animate-spin text-primary" />
						<span className="text-sm text-muted-foreground">
							Reading {fileName}…
						</span>
					</>
				) : (
					<>
						<FileText className="h-6 w-6 text-muted-foreground" />
						<span className="text-sm font-medium text-foreground">
							Drag a PDF here, or choose a file
						</span>
						<span className="text-xs text-muted-foreground">
							No LinkedIn? A CV works too.
						</span>
					</>
				)}
			</button>

			<input
				ref={inputRef}
				type="file"
				accept="application/pdf"
				className="sr-only"
				onChange={(event) => void handleFile(event.target.files?.[0])}
			/>

			{error && <GoLiveCallout tone="danger">{error}</GoLiveCallout>}

			<p className="text-xs leading-relaxed text-muted-foreground">
				A LinkedIn export is read on our own servers and never sent anywhere
				else. Other CVs are read by an AI service to pull out the same details.
				Either way we keep the details, not the file.
			</p>
		</div>
	);
}
