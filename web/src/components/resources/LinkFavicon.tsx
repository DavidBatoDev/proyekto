import { Link2 } from "lucide-react";
import { useState } from "react";

/**
 * Hosts whose favicon already failed once this session. Shared across rows so a
 * dead icon is requested once, not once per link (and not again after a
 * re-render or reopening a folder modal).
 */
const failedFaviconHosts = new Set<string>();

function getFaviconHost(url: string): string | null {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
			return null;
		return parsed.hostname;
	} catch {
		return null;
	}
}

/** DuckDuckGo's icon service - no Google request, and CDN-cached per host. */
function getFaviconUrl(host: string): string {
	return `https://icons.duckduckgo.com/ip3/${host}.ico`;
}

/**
 * Small favicon preview for a resource link. Falls back to the generic link
 * glyph when the URL is unparsable or the icon fails to load (offline hosts,
 * blocked third-party requests).
 */
export function LinkFavicon({
	url,
	className = "h-3.5 w-3.5",
	wrapperClassName = "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700",
}: {
	url: string;
	className?: string;
	wrapperClassName?: string;
}) {
	const host = getFaviconHost(url);
	// Keyed by host rather than a bare boolean: the omnibox input re-renders this
	// on every keystroke, so a failure for one host must not hide the next one.
	const [failedHost, setFailedHost] = useState<string | null>(null);
	const failed = !host || failedHost === host || failedFaviconHosts.has(host);

	return (
		<div className={wrapperClassName}>
			{host && !failed ? (
				<img
					src={getFaviconUrl(host)}
					alt=""
					loading="lazy"
					decoding="async"
					referrerPolicy="no-referrer"
					onError={() => {
						failedFaviconHosts.add(host);
						setFailedHost(host);
					}}
					className={`${className} rounded-sm object-contain`}
				/>
			) : (
				<Link2 className={className} />
			)}
		</div>
	);
}
