import { useState } from "react";

const BIO_CLAMP = 320;

/**
 * The About block both public seller profiles use: clamped bio with an inline
 * "Read more" that sits with the last line, the way the reference reads — not
 * a button parked underneath the paragraph.
 */
export function SellerAbout({
	bio,
	isOwner,
	emptyOwnerCopy,
	emptyVisitorCopy,
}: {
	bio: string | null;
	isOwner: boolean;
	emptyOwnerCopy: string;
	emptyVisitorCopy: string;
}) {
	const [expanded, setExpanded] = useState(false);
	const text = bio?.trim() ?? "";
	const isLong = text.length > BIO_CLAMP;

	if (!text) {
		return (
			<p className="mt-3 text-[15px] text-muted-foreground">
				{isOwner ? emptyOwnerCopy : emptyVisitorCopy}
			</p>
		);
	}

	return (
		<p className="mt-3 max-w-2xl whitespace-pre-line text-[15px] leading-relaxed text-foreground">
			{isLong && !expanded ? `${text.slice(0, BIO_CLAMP).trimEnd()}… ` : text}
			{isLong && (
				<button
					type="button"
					onClick={() => setExpanded((current) => !current)}
					aria-expanded={expanded}
					className="ml-1 font-medium text-foreground underline hover:text-primary"
				>
					{expanded ? "Read less" : "Read more"}
				</button>
			)}
		</p>
	);
}
