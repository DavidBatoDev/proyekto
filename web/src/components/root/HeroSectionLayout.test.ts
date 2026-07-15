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
			"mx-auto flex max-w-[1600px] flex-col items-center px-4 pb-8 pt-8 text-center sm:px-6 sm:pb-10 sm:pt-10 lg:px-8",
		);
		expect(source).not.toContain("min-h-screen");
		expect(source).not.toContain("-mt-20");
		expect(source).not.toContain("pt-24");
	});
});
