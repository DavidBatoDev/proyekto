import { DOC_ARTICLES, type DocArticle, docFileKey } from "./docs.manifest";

/**
 * Article bodies, and the docs search.
 *
 * The glob is deliberately NOT eager: the manifest already carries everything
 * the sidebar, the home page and search need, so a visitor reading one article
 * downloads one article. An eager `?raw` glob would put all 47 bodies in the
 * initial chunk.
 */
const BODIES = import.meta.glob("./docs/**/*.md", {
	query: "?raw",
	import: "default",
}) as Record<string, () => Promise<string>>;

/** Glob keys are relative to this module; the manifest spells them absolute. */
function globKey(article: DocArticle): string {
	return docFileKey(article).replace("/src/content/", "./");
}

export function hasBody(article: DocArticle): boolean {
	return globKey(article) in BODIES;
}

/**
 * The article's markdown. Throws when the file is missing rather than rendering
 * an empty page — `docs.content.test.ts` asserts the manifest and the files
 * agree, so this should only ever fire in development.
 */
export async function loadArticleBody(article: DocArticle): Promise<string> {
	const loader = BODIES[globKey(article)];
	if (!loader) {
		throw new Error(
			`No markdown for "${article.slug}". Expected ${docFileKey(article)}.`,
		);
	}
	return loader();
}

/** Every glob key present on disk, for the drift test. */
export function bodyKeys(): string[] {
	return Object.keys(BODIES).map((key) => key.replace("./", "/src/content/"));
}

export interface DocSearchHit {
	article: DocArticle;
	/** Lower sorts first. */
	rank: number;
}

/**
 * Case-insensitive substring matching over title, description and keywords —
 * the app-wide convention (see `globalSearch.ts`, which states that no fuzzy
 * library exists and none should be introduced).
 *
 * Bodies are not searched: they are lazily loaded, and pulling all 47 down to
 * answer a keystroke would defeat the reason they are lazy. The manifest's
 * `keywords` field exists to carry the words a reader would type that the
 * title does not contain ("kanban", "gantt", "sso"), which is what keeps
 * metadata-only search from feeling thin.
 */
export function searchDocs(
	query: string,
	options: { includeWebOnly: boolean },
): DocSearchHit[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return [];

	const hits: DocSearchHit[] = [];
	for (const article of DOC_ARTICLES) {
		if (!options.includeWebOnly && article.surface === "web") continue;

		const title = article.title.toLowerCase();
		let rank: number | null = null;

		if (title === needle) rank = 0;
		else if (title.startsWith(needle)) rank = 1;
		else if (title.includes(needle)) rank = 2;
		else if (article.description.toLowerCase().includes(needle)) rank = 3;
		else if (article.keywords?.some((k) => k.toLowerCase().includes(needle)))
			rank = 4;
		else if (article.slug.includes(needle)) rank = 5;

		if (rank !== null) hits.push({ article, rank });
	}

	return hits.sort(
		(a, b) => a.rank - b.rank || a.article.title.localeCompare(b.article.title),
	);
}
