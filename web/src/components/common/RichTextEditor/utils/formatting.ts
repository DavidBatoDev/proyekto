import type { FormatCommand } from "../types";

/**
 * Execute a document formatting command
 */
export function executeCommand(
	command: FormatCommand,
	value?: string,
): boolean {
	try {
		document.execCommand(command, false, value);
		return true;
	} catch (error) {
		console.error("Error executing command:", error);
		return false;
	}
}

/**
 * Check if a format is currently active at the cursor position
 */
export function isFormatActive(command: string): boolean {
	try {
		return document.queryCommandState(command);
	} catch {
		return false;
	}
}

/**
 * Get the current format value (e.g., current heading level)
 */
export function getFormatValue(command: string): string {
	try {
		return document.queryCommandValue(command);
	} catch {
		return "";
	}
}

/**
 * Get all active formats at the current selection
 */
export function getActiveFormats(): Set<string> {
	const formats = new Set<string>();
	const commands = [
		"bold",
		"italic",
		"underline",
		"strikeThrough",
		"insertUnorderedList",
		"insertOrderedList",
	];

	commands.forEach((cmd) => {
		if (isFormatActive(cmd)) {
			formats.add(cmd);
		}
	});

	return formats;
}

/**
 * Insert a link at the current selection
 */
export function insertLink(url: string): void {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) return;

	const range = selection.getRangeAt(0);
	const selectedText = range.toString();

	if (!selectedText) {
		// If no text is selected, insert the URL as both text and link
		const link = document.createElement("a");
		link.href = url;
		link.textContent = url;
		link.target = "_blank";
		link.rel = "noopener noreferrer";
		range.insertNode(link);
	} else {
		// If text is selected, wrap it in a link
		executeCommand("createLink", url);
	}
}

/**
 * Insert an image at the current selection
 */
export function insertImage(src: string, alt?: string): void {
	const img = document.createElement("img");
	img.src = src;
	img.alt = alt || "";
	img.style.maxWidth = "100%";
	img.style.height = "auto";

	const selection = window.getSelection();
	if (selection && selection.rangeCount > 0) {
		const range = selection.getRangeAt(0);
		range.deleteContents();
		range.insertNode(img);
	}
}

/**
 * Format the current selection as a heading
 */
export function formatHeading(level: number): void {
	if (level === 0) {
		executeCommand("formatBlock", "p");
	} else {
		executeCommand("formatBlock", `h${level}`);
	}
}

/**
 * Clean up HTML content (remove unwanted tags/attributes)
 */
export function cleanHTML(html: string): string {
	const div = document.createElement("div");
	div.innerHTML = html;

	// Remove script tags
	const scripts = div.querySelectorAll("script");
	scripts.forEach((script) => script.remove());

	// Remove event handlers
	const allElements = div.querySelectorAll("*");
	allElements.forEach((el) => {
		Array.from(el.attributes).forEach((attr) => {
			if (attr.name.startsWith("on")) {
				el.removeAttribute(attr.name);
			}
		});
	});

	return div.innerHTML;
}
