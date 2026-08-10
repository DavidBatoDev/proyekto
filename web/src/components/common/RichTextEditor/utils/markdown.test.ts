// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { htmlToMarkdown, markdownToHtml } from "./markdown";

describe("markdownToHtml", () => {
	it("converts headers correctly", () => {
		expect(markdownToHtml("# Title")).toContain("<h1>Title</h1>");
		expect(markdownToHtml("## Subtitle")).toContain("<h2>Subtitle</h2>");
	});

	it("converts bold and italic text", () => {
		expect(markdownToHtml("**bold text**")).toContain(
			"<strong>bold text</strong>",
		);
		expect(markdownToHtml("*italic text*")).toContain("<em>italic text</em>");
	});

	it("converts links and images safely", () => {
		const linkHtml = markdownToHtml("[Proyekto](https://example.com)");
		expect(linkHtml).toContain(
			'<a href="https://example.com" target="_blank" rel="noopener noreferrer">Proyekto</a>',
		);

		const imgHtml = markdownToHtml("![Logo](https://example.com/logo.png)");
		expect(imgHtml).toContain(
			'<img src="https://example.com/logo.png" alt="Logo" />',
		);
	});

	it("preserves code blocks and escapes HTML within them", () => {
		const markdown = "```\nconst x = '<script>alert(1)</script>';\n```";
		const html = markdownToHtml(markdown);
		expect(html).toContain(
			"<pre><code>const x = '&lt;script&gt;alert(1)&lt;/script&gt;';</code></pre>",
		);
		expect(html).not.toContain("<script>");
	});

	it("handles unordered and ordered lists", () => {
		const ulMarkdown = "- Item 1\n- Item 2";
		const ulHtml = markdownToHtml(ulMarkdown);
		expect(ulHtml).toContain("<ul><li>Item 1</li><li>Item 2</li></ul>");

		const olMarkdown = "1. First\n2. Second";
		const olHtml = markdownToHtml(olMarkdown);
		expect(olHtml).toContain("<ol><li>First</li><li>Second</li></ol>");
	});
});

describe("htmlToMarkdown", () => {
	it("converts HTML headings to markdown", () => {
		expect(htmlToMarkdown("<h1>Heading 1</h1>")).toBe("# Heading 1");
		expect(htmlToMarkdown("<h2>Heading 2</h2>")).toBe("## Heading 2");
	});

	it("converts bold, italic, and links", () => {
		expect(htmlToMarkdown("<strong>Bold</strong>")).toBe("**Bold**");
		expect(htmlToMarkdown('<a href="https://example.com">Link</a>')).toBe(
			"[Link](https://example.com)",
		);
	});

	it("converts lists correctly", () => {
		expect(htmlToMarkdown("<ul><li>One</li><li>Two</li></ul>")).toBe(
			"- One\n- Two",
		);
		expect(htmlToMarkdown("<ol><li>First</li><li>Second</li></ol>")).toBe(
			"1. First\n2. Second",
		);
	});
});
