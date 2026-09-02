import { useState } from "react";
import { isGeneratedRoadmapThumbnailDataUri } from "@/lib/roadmapThumbnail";

/**
 * A template's cover photo, or nothing at all.
 *
 * The same rule `RoadmapPreviewCard` applies to its banner, in the one place
 * that renders a cover outside a card: a generated gradient placeholder is not
 * a picture, and a URL that fails to load leaves a broken frame in the layout —
 * both collapse to null rather than to something worse than no image.
 *
 * Tracking the failed URL rather than a boolean means a later, different cover
 * still gets its own chance to load.
 */
export function TemplateCoverImage({
	src,
	alt = "",
	className,
}: {
	src: string | null | undefined;
	alt?: string;
	className?: string;
}) {
	const [failedUrl, setFailedUrl] = useState<string | null>(null);
	const url = src?.trim() || null;

	if (!url || failedUrl === url || isGeneratedRoadmapThumbnailDataUri(url)) {
		return null;
	}

	return (
		<img
			src={url}
			alt={alt}
			loading="lazy"
			decoding="async"
			onError={() => setFailedUrl(url)}
			className={className}
		/>
	);
}
