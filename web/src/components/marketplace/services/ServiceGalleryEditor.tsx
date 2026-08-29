import {
	ChevronLeft,
	ChevronRight,
	ImagePlus,
	Loader2,
	Star,
	X,
} from "lucide-react";
import { useRef, useState } from "react";
import { useToast } from "@/hooks/useToast";
import { type PendingImage, srcOf } from "@/lib/pendingImages";
import { cn } from "@/lib/utils";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BYTES = 20 * 1024 * 1024;
export const MAX_SERVICE_IMAGES = 7; // 1 cover + 6 gallery, matching the API cap.

/**
 * The WYSIWYG gallery: renders exactly like the public ServiceGallery —
 * aspect-video cover with a thumbnail switcher — with the editing controls
 * layered on top.
 *
 * Presentational on purpose. Picked files are held by the caller (via
 * `usePendingImages`) and only uploaded when the service is saved, so
 * abandoning an edit leaves nothing behind in R2. Type and size are still
 * validated here, at pick time: a rejected file must say so immediately, not
 * twenty minutes later at save.
 */
export function ServiceGalleryEditor({
	items,
	busy,
	onAdd,
	onRemove,
	onPromote,
}: {
	items: PendingImage[];
	busy: boolean;
	onAdd: (files: File[]) => void;
	onRemove: (key: string) => void;
	onPromote: (key: string) => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const toast = useToast();
	const [selected, setSelected] = useState(0);

	const active = items[selected] ?? items[0];

	const pickFiles = (files: FileList | null) => {
		if (!files?.length) return;
		const room = MAX_SERVICE_IMAGES - items.length;
		const picked = Array.from(files).slice(0, Math.max(room, 0));
		if (picked.length === 0) {
			toast.error(`Up to ${MAX_SERVICE_IMAGES} images per service.`);
			return;
		}

		const valid = picked.filter((file) => {
			if (!ACCEPTED.includes(file.type)) {
				toast.error(`${file.name}: only JPEG, PNG, WebP or GIF.`);
				return false;
			}
			if (file.size > MAX_BYTES) {
				toast.error(`${file.name}: images must be under 20 MB.`);
				return false;
			}
			return true;
		});

		if (valid.length) onAdd(valid);
		if (inputRef.current) inputRef.current.value = "";
	};

	const step = (delta: number) =>
		setSelected((current) => (current + delta + items.length) % items.length);

	return (
		<div>
			{items.length === 0 ? (
				<button
					type="button"
					onClick={() => inputRef.current?.click()}
					disabled={busy}
					className="flex aspect-video w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-input text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-60"
				>
					<ImagePlus className="h-6 w-6" />
					<span className="text-sm font-medium">Add cover image</span>
					<span className="text-xs">
						Buyers see this first. Up to {MAX_SERVICE_IMAGES} images.
					</span>
				</button>
			) : (
				<div className="group relative overflow-hidden rounded-2xl border border-border bg-muted">
					<img
						src={srcOf(active)}
						alt=""
						className="aspect-video w-full object-cover"
						loading="eager"
						decoding="async"
					/>
					<button
						type="button"
						onClick={() => {
							setSelected(0);
							onRemove(active.key);
						}}
						aria-label="Remove this image"
						className="absolute right-3 top-3 cursor-pointer rounded-full bg-background/80 p-1.5 text-foreground opacity-0 transition-opacity hover:bg-background group-hover:opacity-100"
					>
						<X className="h-4 w-4" />
					</button>
					<span className="absolute left-3 top-3 flex items-center gap-1.5">
						{selected === 0 && (
							<span className="rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
								Cover
							</span>
						)}
						{active.file && (
							<span className="rounded-full bg-background/90 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
								Not saved yet
							</span>
						)}
					</span>
					{items.length > 1 && (
						<>
							<GalleryArrow direction="prev" onClick={() => step(-1)} />
							<GalleryArrow direction="next" onClick={() => step(1)} />
						</>
					)}
				</div>
			)}

			{items.length > 0 && (
				<div className="mt-3 flex gap-2 overflow-x-auto hide-scrollbar">
					{items.map((item, index) => (
						<span key={item.key} className="group/thumb relative shrink-0">
							<button
								type="button"
								onClick={() => setSelected(index)}
								aria-label={`Show image ${index + 1}`}
								aria-pressed={index === selected}
								className={cn(
									"cursor-pointer overflow-hidden rounded-lg border-2 transition-colors",
									index === selected
										? "border-primary"
										: "border-transparent hover:border-border",
								)}
							>
								<img
									src={srcOf(item)}
									alt=""
									className={cn(
										"block h-14 w-24 object-cover",
										item.file && "opacity-80",
									)}
									loading="lazy"
									decoding="async"
								/>
							</button>
							{index > 0 && (
								<button
									type="button"
									onClick={() => {
										setSelected(0);
										onPromote(item.key);
									}}
									title="Make cover"
									aria-label="Make this the cover image"
									className="absolute left-1 top-1 cursor-pointer rounded-full bg-background/80 p-1 text-foreground opacity-0 transition-opacity group-hover/thumb:opacity-100"
								>
									<Star className="h-3 w-3" />
								</button>
							)}
							<button
								type="button"
								onClick={() => {
									setSelected(0);
									onRemove(item.key);
								}}
								aria-label="Remove image"
								className="absolute right-1 top-1 cursor-pointer rounded-full bg-background/80 p-1 text-foreground opacity-0 transition-opacity group-hover/thumb:opacity-100"
							>
								<X className="h-3 w-3" />
							</button>
						</span>
					))}

					{items.length < MAX_SERVICE_IMAGES && (
						<button
							type="button"
							onClick={() => inputRef.current?.click()}
							disabled={busy}
							aria-label="Add images"
							className="flex h-14 w-24 shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-input text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-60"
						>
							{busy ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<ImagePlus className="h-4 w-4" />
							)}
							<span className="text-[10px] font-medium">
								{busy ? "Saving" : "Add"}
							</span>
						</button>
					)}
				</div>
			)}

			<input
				ref={inputRef}
				type="file"
				accept={ACCEPTED.join(",")}
				multiple
				className="sr-only"
				onChange={(event) => pickFiles(event.target.files)}
			/>
		</div>
	);
}

/** Matches the public gallery's arrows, so the editor reads the same. */
function GalleryArrow({
	direction,
	onClick,
}: {
	direction: "prev" | "next";
	onClick: () => void;
}) {
	const isPrev = direction === "prev";
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={isPrev ? "Previous image" : "Next image"}
			className={cn(
				"absolute top-1/2 -translate-y-1/2 cursor-pointer rounded-full bg-background/90 p-2 text-foreground shadow-sm transition-opacity hover:bg-background focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100",
				isPrev ? "left-3" : "right-3",
			)}
		>
			{isPrev ? (
				<ChevronLeft className="h-5 w-5" />
			) : (
				<ChevronRight className="h-5 w-5" />
			)}
		</button>
	);
}
