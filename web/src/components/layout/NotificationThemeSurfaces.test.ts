import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const NOTIFICATION_SURFACES = [
	"routes/notifications.tsx",
	"components/layout/NotificationBell.tsx",
	"contexts/ToastContext.tsx",
	"lib/notificationLabels.ts",
];

const FIXED_COLOR =
	/\b(?:bg|text|border|ring|shadow|from|via|to)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\d+)?\b|#[\da-f]{3,8}\b/gi;

describe("notification theme surfaces", () => {
	it.each(NOTIFICATION_SURFACES)(
		"uses semantic theme colors in %s",
		(relativePath) => {
			const source = readFileSync(
				resolve(process.cwd(), "src", relativePath),
				"utf8",
			);

			expect(source.match(FIXED_COLOR) ?? []).toEqual([]);
		},
	);

	it("uses theme status tokens for notification meaning", () => {
		const page = readFileSync(
			resolve(process.cwd(), "src/routes/notifications.tsx"),
			"utf8",
		);
		const toast = readFileSync(
			resolve(process.cwd(), "src/contexts/ToastContext.tsx"),
			"utf8",
		);
		// The page and the bell read each notification type's tone from one
		// shared table, so the status tokens live there.
		const labels = readFileSync(
			resolve(process.cwd(), "src/lib/notificationLabels.ts"),
			"utf8",
		);

		expect(page).toContain("notificationToneClass");
		expect(labels).toContain("text-success");
		expect(labels).toContain("text-warning");
		expect(labels).toContain("text-destructive");
		expect(page).toContain("bg-primary/10");
		expect(toast).toContain("bg-popover");
		expect(toast).toContain("text-popover-foreground");
		expect(toast).toContain("border-l-success");
	});
});
