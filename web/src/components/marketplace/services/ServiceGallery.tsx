import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Cover + gallery with a thumbnail switcher — the Fiverr gig-gallery shape.
 * Falls back to a quiet placeholder block when the seller uploaded nothing,
 * so the page never shows a broken-image icon.
 */
export function ServiceGallery({
	title,
	coverUrl,
	galleryUrls,
}: {
	title: string;
	coverUrl: string | null;
	galleryUrls: string[];
}) {
	const images = [coverUrl, ...galleryUrls].filter(
		(url): url is string => !!url,
	);
	const [selected, setSelected] = useState(0);
	const active = images[selected] ?? images[0];

	if (images.length === 0) {
		return (
			<div className="flex aspect-video items-center justify-center rounded-2xl border border-border bg-muted text-sm text-muted-foreground">
				No images yet
			</div>
		);
	}

	const step = (delta: number) =>
		setSelected((current) => (current + delta + images.length) % images.length);

	return (
		<div>
			<div className="group relative overflow-hidden rounded-2xl border border-border bg-muted">
				<img
					src={active}
					alt={title}
					className="aspect-video w-full object-cover"
					loading="eager"
					decoding="async"
				/>
				{images.length > 1 && (
					<>
						<GalleryArrow direction="prev" onClick={() => step(-1)} />
						<GalleryArrow direction="next" onClick={() => step(1)} />
					</>
				)}
			</div>
			{images.length > 1 && (
				<div className="mt-3 flex gap-2 overflow-x-auto hide-scrollbar">
					{images.map((url, index) => (
						<button
							key={url}
							type="button"
							onClick={() => setSelected(index)}
							aria-label={`Show image ${index + 1}`}
							aria-pressed={index === selected}
							className={cn(
								"shrink-0 cursor-pointer overflow-hidden rounded-lg border-2 transition-colors",
								index === selected
									? "border-primary"
									: "border-transparent hover:border-border",
							)}
						>
							<img
								src={url}
								alt=""
								className="h-14 w-24 object-cover"
								loading="lazy"
								decoding="async"
							/>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

/** Wraps around, so the last image steps forward to the first. */
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
