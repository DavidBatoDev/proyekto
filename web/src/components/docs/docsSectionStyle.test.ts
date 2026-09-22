import { describe, expect, it } from "vitest";
import { DOC_SECTIONS } from "@/content/docs.manifest";
import { SECTION_STYLE, sectionStyle } from "./docsSectionStyle";

describe("docs section style", () => {
	it("styles every section the manifest declares", () => {
		// The two files are keyed by the same ids but live apart, so this is the
		// only thing stopping a new section rendering with no icon.
		for (const section of DOC_SECTIONS) {
			expect(sectionStyle(section.id), section.id).toBeDefined();
			expect(sectionStyle(section.id).icon, section.id).toBeTruthy();
		}
	});

	it("styles nothing the manifest does not declare", () => {
		const ids = new Set(DOC_SECTIONS.map((s) => s.id));
		for (const key of Object.keys(SECTION_STYLE)) {
			expect(ids.has(key as never), key).toBe(true);
		}
	});

	it("gives each section its own colour", () => {
		// Colour is an index here, not decoration: two sections sharing a tint
		// makes the rail harder to scan, not prettier.
		const tones = DOC_SECTIONS.map((s) => sectionStyle(s.id).tone);
		expect(new Set(tones).size).toBe(tones.length);
	});

	it("keeps every tint readable in both themes", () => {
		// The idiom from CATEGORY_TONES in roadmap-templates: a 15% fill that
		// works on any ground, and a foreground that flips at `dark:` because a
		// 700-weight colour readable on white disappears on navy.
		for (const section of DOC_SECTIONS) {
			const tone = sectionStyle(section.id).tone;
			expect(tone, section.id).toMatch(/bg-\w+-500\/15/);
			expect(tone, section.id).toMatch(/dark:text-\w+-300/);
		}
	});
});
