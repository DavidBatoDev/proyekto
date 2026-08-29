/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
	isRichTextEmpty,
	looksLikeHtml,
	richTextToPlain,
	sanitizeRichHtml,
} from "./richText";

describe("isRichTextEmpty", () => {
	it("treats an empty editor's markup as empty", () => {
		expect(isRichTextEmpty("<p><br></p>")).toBe(true);
		expect(isRichTextEmpty("<p>&nbsp;</p>")).toBe(true);
		expect(isRichTextEmpty("")).toBe(true);
		expect(isRichTextEmpty(null)).toBe(true);
	});

	it("counts visible text as content", () => {
		expect(isRichTextEmpty("<p>Hi</p>")).toBe(false);
	});
});

describe("looksLikeHtml", () => {
	it("recognises what the editor emits", () => {
		expect(looksLikeHtml("<p>Written in the editor</p>")).toBe(true);
		expect(looksLikeHtml("<ul><li>One</li></ul>")).toBe(true);
	});

	/**
	 * The legacy path: every section written before the rich editor is markdown,
	 * and reading one as HTML would swallow its bullets and bold.
	 */
	it("leaves markdown alone", () => {
		expect(looksLikeHtml("**Bold** and a list:\n- one\n- two")).toBe(false);
		expect(looksLikeHtml("Latency < 200ms on p95")).toBe(false);
	});
});

describe("sanitizeRichHtml", () => {
	it("keeps the formatting sellers actually write", () => {
		const clean = sanitizeRichHtml(
			'<p><strong>Bold</strong> and <a href="https://example.com">a link</a></p><ul><li>One</li></ul>',
		);
		expect(clean).toContain("<strong>Bold</strong>");
		expect(clean).toContain('href="https://example.com"');
		expect(clean).toContain("<li>One</li>");
	});

	/**
	 * The API takes any string the seller's own request carries, and this body
	 * is rendered to strangers — so these must not survive the render.
	 */
	it("drops script, handlers and javascript: urls", () => {
		expect(
			sanitizeRichHtml("<p>Hi</p><script>alert(1)</script>"),
		).not.toContain("script");
		expect(sanitizeRichHtml('<p onclick="steal()">Hi</p>')).not.toContain(
			"onclick",
		);
		expect(
			sanitizeRichHtml('<a href="javascript:alert(1)">tap</a>'),
		).not.toContain("javascript:");
		expect(sanitizeRichHtml('<img src=x onerror="alert(1)">')).not.toContain(
			"onerror",
		);
	});

	it("drops styling hooks that would reach into the page", () => {
		const clean = sanitizeRichHtml(
			'<p style="position:fixed" class="fixed inset-0" id="hijack">Hi</p>',
		);
		expect(clean).toBe("<p>Hi</p>");
	});
});

describe("richTextToPlain", () => {
	it("turns a document into one line of text", () => {
		expect(richTextToPlain("<p>First para</p><p>Second para</p>")).toBe(
			"First para Second para",
		);
	});

	it("decodes the entities the editor writes", () => {
		expect(richTextToPlain("<p>Ship&nbsp;fast &amp; safely</p>")).toBe(
			"Ship fast & safely",
		);
	});

	it("passes markdown through untouched apart from whitespace", () => {
		expect(richTextToPlain("**Bold**   text")).toBe("**Bold** text");
	});
});
