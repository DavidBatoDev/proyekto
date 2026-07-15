import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("homepage hero layout", () => {
	it("matches the template marketplace hero height rhythm", () => {
		const source = readFileSync(
			resolve(process.cwd(), "src/components/root/HeroSection.tsx"),
			"utf8",
		);

		expect(source).toContain(
			"mx-auto flex max-w-[1600px] flex-col items-center px-4 pb-16 pt-16 text-center sm:px-6 sm:pb-16 sm:pt-16 lg:px-8",
		);
		expect(source).not.toContain("min-h-screen");
		expect(source).not.toContain("-mt-20");
		expect(source).not.toContain("pt-24");
		expect(source).toContain('to="/roadmap-templates"');
		expect(source).toContain("<Home");
		expect(source).toContain("<LayoutTemplate");
		expect(source).toContain("bg-primary px-3 py-1.5");
		expect(source).toContain("text-primary-foreground");
		expect(source).toContain("text-balance text-4xl font-bold");
		expect(source).toContain("text-white sm:text-5xl");
		expect(source).toContain("max-w-2xl text-sm leading-relaxed");
		expect(source).toContain("text-white/80 sm:text-base");
		expect(source).not.toContain("lg:text-7xl");
		expect(source).not.toContain("Simple. Flexible. Powerful.");
	});
});
