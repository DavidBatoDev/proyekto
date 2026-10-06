/* @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import { overlayOpen } from "./overlayOpen";

function mount(html: string) {
	document.body.innerHTML = html;
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("overlayOpen", () => {
	it("is false with no overlay in the page", () => {
		mount("<main><button>Save</button></main>");
		expect(overlayOpen()).toBe(false);
	});

	it("is true while a dialog, an alert dialog or a menu is open", () => {
		for (const role of ["dialog", "alertdialog", "menu"]) {
			mount(`<div role="${role}">Open</div>`);
			expect(overlayOpen()).toBe(true);
		}
	});

	it("skips closed overlays that stay mounted (the inert nav drawer, hidden, aria-hidden)", () => {
		mount(`
			<div role="dialog" inert>Nav drawer</div>
			<div role="menu" hidden>Menu</div>
			<div aria-hidden="true"><div role="dialog">Behind</div></div>
		`);
		expect(overlayOpen()).toBe(false);
	});

	it("is true when an open dialog sits beside a closed one", () => {
		mount(`
			<div role="dialog" inert>Nav drawer</div>
			<div role="dialog">Edit time</div>
		`);
		expect(overlayOpen()).toBe(true);
	});
});
