/**
 * PortfolioModal — Add portfolio item with inline image upload
 * Image is uploaded to the portfolio_projects bucket before the portfolio record is saved.
 */

import {
	AlertCircle,
	ImageIcon,
	LayoutGrid,
	Link as LinkIcon,
	Loader2,
	Upload,
	X,
} from "lucide-react";
import {
	type DragEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { UserPortfolio } from "@/services/profile.service";
import { uploadService } from "@/services/upload.service";
import { ProfileModal } from "./ProfileModal";

type PortPayload = Omit<
	UserPortfolio,
	"id" | "user_id" | "created_at" | "updated_at"
>;

interface Props {
	isOpen: boolean;
	onClose: () => void;
	onSave: (payload: PortPayload) => void;
	isSaving?: boolean;
	nextPosition?: number;
	initialData?: Partial<UserPortfolio>;
}

function formatBytes(bytes: number) {
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BYTES = 20 * 1024 * 1024;

export function PortfolioModal({
	isOpen,
	onClose,
	onSave,
	isSaving,
	nextPosition = 0,
	initialData,
}: Props) {
	const isEdit = !!initialData;
	const empty: PortPayload = {
		title: "",
		description: null,
		url: null,
		image_url: null,
		tags: [],
		position: nextPosition,
	};
	const [form, setForm] = useState<PortPayload>(empty);
	const [tagInput, setTagInput] = useState("");

	// Image upload state
	const [imageFile, setImageFile] = useState<File | null>(null);
	const [imagePreview, setImagePreview] = useState<string | null>(null);
	const [imageError, setImageError] = useState<string | null>(null);
	const [isUploading, setIsUploading] = useState(false);
	const [dragging, setDragging] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const set = (k: keyof PortPayload, v: unknown) =>
		setForm((p) => ({ ...p, [k]: v }));

	// Pre-fill on open (edit mode)
	useEffect(() => {
		if (isOpen) {
			if (initialData) {
				setForm({
					title: initialData.title ?? "",
					description: initialData.description ?? null,
					url: initialData.url ?? null,
					image_url: initialData.image_url ?? null,
					tags: initialData.tags ?? [],
					position: initialData.position ?? nextPosition,
				});
				// If there's an existing image, show it as preview (no File object)
				setImagePreview(initialData.image_url ?? null);
			} else {
				setForm(empty);
				setImagePreview(null);
			}
			setImageFile(null);
			setImageError(null);
			setTagInput("");
		}
	}, [isOpen, initialData]);

	const resetImage = () => {
		if (imagePreview) URL.revokeObjectURL(imagePreview);
		setImageFile(null);
		setImagePreview(null);
		setImageError(null);
		set("image_url", null);
		if (inputRef.current) inputRef.current.value = "";
	};

	const handleClose = () => {
		setForm(empty);
		setTagInput("");
		resetImage();
		onClose();
	};

	const pickFile = useCallback(
		(file: File | null | undefined) => {
			if (!file) return;
			setImageError(null);
			if (!ACCEPTED.includes(file.type)) {
				setImageError("Unsupported type — use JPEG, PNG, WebP or GIF.");
				return;
			}
			if (file.size > MAX_BYTES) {
				setImageError(`File too large: ${formatBytes(file.size)} (max 20 MB).`);
				return;
			}
			if (imagePreview) URL.revokeObjectURL(imagePreview);
			setImageFile(file);
			setImagePreview(URL.createObjectURL(file));
			set("image_url", null); // will be filled after upload
		},
		[imagePreview],
	);

	const handleDrop = (e: DragEvent) => {
		e.preventDefault();
		setDragging(false);
		pickFile(e.dataTransfer.files[0]);
	};

	const handleSave = async () => {
		if (!form.title.trim()) return;
		let finalForm = { ...form };

		// Upload image first if one was picked but not yet uploaded
		if (imageFile && !form.image_url) {
			setIsUploading(true);
			try {
				const url = await uploadService.uploadPortfolioImage(imageFile);
				finalForm = { ...finalForm, image_url: url };
				set("image_url", url);
			} catch {
				setImageError("Image upload failed. Please try again.");
				setIsUploading(false);
				return;
			} finally {
				setIsUploading(false);
			}
		}

		onSave(finalForm);
		// don't reset here — wait for isSaving to clear (parent closes modal on success)
	};

	const addTag = () => {
		const t = tagInput.trim();
		if (t && !form.tags.includes(t)) set("tags", [...form.tags, t]);
		setTagInput("");
	};
	const removeTag = (tag: string) =>
		set(
			"tags",
			form.tags.filter((t) => t !== tag),
		);

	const isBusy = isUploading || isSaving;

	return (
		<ProfileModal
			isOpen={isOpen}
			onClose={handleClose}
			title={isEdit ? "Edit Portfolio Item" : "Add Portfolio Item"}
			width="lg"
		>
			<div className="space-y-5">
				{/* Cover image upload zone */}
				<div>
					<label className="block text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
						Cover Image{" "}
						<span className="font-normal normal-case text-muted-foreground">
							(optional · JPEG, PNG, WebP, GIF · max 20 MB)
						</span>
					</label>

					{/* Drop zone — shown when no image picked */}
					{!imagePreview ? (
						<div
							onDragOver={(e) => {
								e.preventDefault();
								setDragging(true);
							}}
							onDragLeave={() => setDragging(false)}
							onDrop={handleDrop}
							onClick={() => inputRef.current?.click()}
							className={`relative flex flex-col items-center justify-center gap-3 w-full aspect-video rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
								dragging
									? "border-primary bg-primary/5"
									: "border-border hover:border-primary/50 hover:bg-muted/40"
							}`}
						>
							<div
								className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${dragging ? "bg-primary/10" : "bg-muted"}`}
							>
								<Upload
									className={`w-5 h-5 transition-colors ${dragging ? "text-primary" : "text-muted-foreground"}`}
								/>
							</div>
							<div className="text-center">
								<p className="text-sm font-semibold text-foreground">
									{dragging
										? "Drop to set cover"
										: "Drag & drop or click to upload"}
								</p>
								<p className="text-xs text-muted-foreground">
									Recommended: 16:9 landscape, at least 1280×720
								</p>
							</div>
							<input
								ref={inputRef}
								type="file"
								accept={ACCEPTED.join(",")}
								className="hidden"
								onChange={(e) => pickFile(e.target.files?.[0])}
							/>
						</div>
					) : (
						/* Preview */
						<div className="relative w-full aspect-video rounded-xl overflow-hidden border border-border bg-muted/40 group">
							<img
								src={imagePreview}
								alt="Cover preview"
								className="w-full h-full object-cover"
							/>
							{/* Overlay on hover */}
							<div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
								<button
									onClick={() => {
										resetImage();
										inputRef.current?.click();
									}}
									className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 bg-card text-foreground text-xs font-semibold px-3 py-1.5 rounded-full shadow"
								>
									<Upload className="w-3.5 h-3.5" /> Replace
								</button>
							</div>
							{/* Remove button */}
							<button
								onClick={resetImage}
								className="absolute top-2 right-2 w-7 h-7 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center text-white transition-colors"
								title="Remove image"
							>
								<X className="w-3.5 h-3.5" />
							</button>
							{/* File name badge */}
							<div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/50 text-white text-xs px-2.5 py-1 rounded-full backdrop-blur-sm">
								<ImageIcon className="w-3 h-3" />
								<span className="max-w-[200px] truncate">
									{imageFile?.name}
								</span>
								<span className="text-white/60">
									· {formatBytes(imageFile?.size ?? 0)}
								</span>
							</div>
						</div>
					)}

					{imageError && (
						<div className="flex items-center gap-1.5 mt-1.5 text-xs text-destructive">
							<AlertCircle className="w-3.5 h-3.5 shrink-0" />
							{imageError}
						</div>
					)}
				</div>

				{/* Title */}
				<div>
					<label className="block text-xs font-semibold text-muted-foreground mb-1">
						Project Title <span className="text-destructive">*</span>
					</label>
					<input
						value={form.title}
						onChange={(e) => set("title", e.target.value)}
						maxLength={100}
						className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
						placeholder="e.g. E-Commerce Platform for Fintech Startup"
					/>
					<p className="text-xs text-muted-foreground text-right mt-0.5">
						{100 - form.title.length} characters left
					</p>
				</div>

				{/* Description */}
				<div>
					<label className="block text-xs font-semibold text-muted-foreground mb-1">
						Description
					</label>
					<textarea
						value={form.description ?? ""}
						onChange={(e) => set("description", e.target.value || null)}
						rows={3}
						maxLength={600}
						className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
						placeholder="What problem did it solve? What was your role and impact?"
					/>
					<p className="text-xs text-muted-foreground text-right mt-0.5">
						{600 - (form.description?.length ?? 0)} characters left
					</p>
				</div>

				{/* Live URL */}
				<div>
					<label className="block text-xs font-semibold text-muted-foreground mb-1">
						Live Project URL
					</label>
					<div className="relative">
						<LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
						<input
							type="url"
							value={form.url ?? ""}
							onChange={(e) => set("url", e.target.value || null)}
							className="w-full pl-8 pr-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
							placeholder="https://..."
						/>
					</div>
				</div>

				{/* Tags */}
				<div>
					<label className="block text-xs font-semibold text-muted-foreground mb-1">
						Tags
					</label>
					<div className="flex gap-2">
						<input
							value={tagInput}
							onChange={(e) => setTagInput(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									addTag();
								}
							}}
							className="flex-1 px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
							placeholder="e.g. React, Stripe (press Enter)"
						/>
						<button
							type="button"
							onClick={addTag}
							className="px-3 py-2 border border-input rounded-lg text-sm hover:bg-muted/40 text-muted-foreground"
						>
							Add
						</button>
					</div>
					{form.tags.length > 0 && (
						<div className="flex flex-wrap gap-1.5 mt-2">
							{form.tags.map((tag) => (
								<span
									key={tag}
									className="inline-flex items-center gap-1 px-2.5 py-1 bg-muted rounded-full text-xs text-foreground"
								>
									{tag}
									<button
										onClick={() => removeTag(tag)}
										className="text-muted-foreground hover:text-foreground ml-0.5"
									>
										×
									</button>
								</span>
							))}
						</div>
					)}
				</div>

				{/* Actions */}
				<div className="flex justify-end gap-3 pt-1 border-t border-border">
					<button
						onClick={handleClose}
						disabled={isBusy}
						className="px-5 py-2 text-sm border border-input text-muted-foreground rounded-lg hover:bg-muted/40 transition-colors disabled:opacity-60"
					>
						Cancel
					</button>
					<button
						onClick={handleSave}
						disabled={isBusy || !form.title.trim() || !!imageError}
						className="px-5 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-60 transition-colors flex items-center gap-2"
					>
						{isUploading ? (
							<>
								<Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading
								image…
							</>
						) : isSaving ? (
							<>
								<Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…
							</>
						) : (
							<>
								<LayoutGrid className="w-3.5 h-3.5" /> Add to Portfolio
							</>
						)}
					</button>
				</div>
			</div>
		</ProfileModal>
	);
}
