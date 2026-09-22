import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { searchDocs } from "@/content/docsContent";
import { isNativeApp } from "@/lib/platform";
import { cn } from "@/lib/utils";

/**
 * Docs search.
 *
 * A separate component from the app's `GlobalSearchBar` on purpose: that one
 * returns null without a signed-in user and is wired to project and roadmap
 * queries, neither of which a public docs page has. What is shared is the
 * convention — case-insensitive substring matching, one flat result list, and
 * a single `activeIndex` driving both the highlight and what Enter commits, so
 * the two can never disagree.
 */
export function DocsSearch({ className }: { className?: string }) {
	const navigate = useNavigate();
	const inputRef = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const native = isNativeApp();

	const hits = useMemo(
		() => searchDocs(query, { includeWebOnly: !native }).slice(0, 8),
		[query, native],
	);

	const open = query.trim().length > 0;

	function go(index: number) {
		const hit = hits[index];
		if (!hit) return;
		setQuery("");
		void navigate({
			to: "/docs/$section/$slug",
			params: { section: hit.article.section, slug: hit.article.slug },
		});
	}

	return (
		<div className={cn("relative", className)}>
			<div className="flex h-11 items-center gap-2.5 rounded-xl border border-border bg-card px-3.5">
				<Search
					className="h-4 w-4 shrink-0 text-muted-foreground"
					aria-hidden
				/>
				<input
					ref={inputRef}
					type="search"
					value={query}
					aria-label="Search documentation"
					placeholder="Search the docs…"
					className="h-full w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
					onChange={(event) => {
						setQuery(event.target.value);
						setActiveIndex(0);
					}}
					onKeyDown={(event) => {
						if (event.key === "ArrowDown") {
							event.preventDefault();
							setActiveIndex((i) => Math.min(i + 1, hits.length - 1));
						} else if (event.key === "ArrowUp") {
							event.preventDefault();
							setActiveIndex((i) => Math.max(i - 1, 0));
						} else if (event.key === "Enter") {
							event.preventDefault();
							go(activeIndex);
						} else if (event.key === "Escape") {
							setQuery("");
						}
					}}
				/>
			</div>

			{open ? (
				<div className="absolute left-0 right-0 top-[3.25rem] z-20 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
					{hits.length === 0 ? (
						<p className="px-4 py-3 text-sm text-muted-foreground">
							Nothing matches “{query.trim()}”.
						</p>
					) : (
						<ul aria-label="Search results">
							{hits.map((hit, index) => (
								<li key={`${hit.article.section}/${hit.article.slug}`}>
									<button
										type="button"
										onMouseEnter={() => setActiveIndex(index)}
										onClick={() => go(index)}
										className={cn(
											"block w-full px-4 py-2.5 text-left transition-colors",
											index === activeIndex ? "bg-muted" : "hover:bg-muted/60",
										)}
									>
										<span className="block text-sm font-medium text-foreground">
											{hit.article.title}
										</span>
										<span className="mt-0.5 block truncate text-xs text-muted-foreground">
											{hit.article.description}
										</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			) : null}
		</div>
	);
}
