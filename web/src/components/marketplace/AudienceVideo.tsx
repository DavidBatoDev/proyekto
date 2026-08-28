import { ExplainerVideo } from "@/components/common/ExplainerVideo";

/**
 * The motion-graphics explainer that opens each half of `/start-selling`.
 *
 * Only the page-specific framing lives here — the centred max-w-5xl inset and
 * the marketplace's own rhythm. Everything that makes a decorative video safe
 * (the poster layer, the reduced-motion path, the text alternative) is in
 * `ExplainerVideo`, shared with the MCP settings clip, so that logic exists
 * once.
 *
 * No separate portrait cut is needed. Unlike the full-bleed hero, this is a
 * 16:9 inset that simply scales down on a phone.
 */
export function AudienceVideo({
	src,
	poster,
	steps,
}: {
	/** Root-relative path, including the `?v=` cache-bust. */
	src: string;
	poster: string;
	/** The beats the clip shows, as the text alternative for the video. */
	steps: readonly string[];
}) {
	return (
		<div className="mx-auto mt-10 max-w-7xl px-4 sm:px-6 lg:px-10">
			<ExplainerVideo
				src={src}
				poster={poster}
				steps={steps}
				className="mx-auto max-w-5xl"
			/>
		</div>
	);
}
