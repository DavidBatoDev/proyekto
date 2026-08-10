/**
 * Convert HTML to Markdown
 */
export function htmlToMarkdown(html: string): string {
	if (!html) return "";
	if (typeof document === "undefined") {
		// Basic regex fallback if running in non-DOM environment
		return html
			.replace(/<h1>(.*?)<\/h1>/gi, "# $1\n\n")
			.replace(/<h2>(.*?)<\/h2>/gi, "## $1\n\n")
			.replace(/<h3>(.*?)<\/h3>/gi, "### $1\n\n")
			.replace(/<strong>(.*?)<\/strong>/gi, "**$1**")
			.replace(/<b>(.*?)<\/b>/gi, "**$1**")
			.replace(/<em>(.*?)<\/em>/gi, "*$1*")
			.replace(/<i>(.*?)<\/i>/gi, "*$1*")
			.replace(/<a href="(.*?)">(.*?)<\/a>/gi, "[$2]($1)")
			.replace(/<li>(.*?)<\/li>/gi, "- $1\n")
			.replace(/<[^>]+>/g, "")
			.trim();
	}

	const div = document.createElement("div");
	div.innerHTML = html;

	return processNode(div).trim();
}

function processNode(node: Node): string {
	if (node.nodeType === Node.TEXT_NODE) {
		return node.textContent || "";
	}

	if (node.nodeType !== Node.ELEMENT_NODE) {
		return "";
	}

	const element = node as HTMLElement;

	// Handle mention spans
	if (
		element.tagName.toLowerCase() === "span" &&
		element.classList.contains("mention")
	) {
		return element.textContent || "";
	}

	const tagName = element.tagName.toLowerCase();
	let result = "";

	switch (tagName) {
		case "h1":
			result = `# ${getTextContent(element)}\n\n`;
			break;
		case "h2":
			result = `## ${getTextContent(element)}\n\n`;
			break;
		case "h3":
			result = `### ${getTextContent(element)}\n\n`;
			break;
		case "h4":
			result = `#### ${getTextContent(element)}\n\n`;
			break;
		case "h5":
			result = `##### ${getTextContent(element)}\n\n`;
			break;
		case "h6":
			result = `###### ${getTextContent(element)}\n\n`;
			break;
		case "p":
			result = `${processChildren(element)}\n\n`;
			break;
		case "strong":
		case "b":
			result = `**${processChildren(element)}**`;
			break;
		case "em":
		case "i":
			result = `*${processChildren(element)}*`;
			break;
		case "u":
			result = `<u>${processChildren(element)}</u>`;
			break;
		case "s":
		case "strike":
		case "del":
			result = `~~${processChildren(element)}~~`;
			break;
		case "a": {
			const href = element.getAttribute("href") || "";
			const text = processChildren(element);
			result = text ? `[${text}](${href})` : href;
			break;
		}
		case "img": {
			const src = element.getAttribute("src") || "";
			const alt = element.getAttribute("alt") || "";
			result = `![${alt}](${src})`;
			break;
		}
		case "ul":
		case "ol":
			result = `${processChildren(element)}\n`;
			break;
		case "li": {
			const parent = element.parentElement;
			const isOrdered = parent?.tagName.toLowerCase() === "ol";
			const index =
				isOrdered && parent
					? Array.from(parent.children).indexOf(element) + 1
					: 1;
			const prefix = isOrdered ? `${index}. ` : "- ";
			result = `${prefix}${processChildren(element).trim()}\n`;
			break;
		}
		case "blockquote":
			result = `> ${processChildren(element).trim()}\n\n`;
			break;
		case "code":
			if (element.parentElement?.tagName.toLowerCase() === "pre") {
				result = `\`\`\`\n${getTextContent(element)}\n\`\`\`\n\n`;
			} else {
				result = `\`${getTextContent(element)}\``;
			}
			break;
		case "pre":
			result = processChildren(element);
			break;
		case "br":
			result = "\n";
			break;
		case "hr":
			result = "---\n\n";
			break;
		default:
			result = processChildren(element);
	}

	return result;
}

function processChildren(element: HTMLElement): string {
	let result = "";
	element.childNodes.forEach((child) => {
		result += processNode(child);
	});
	return result;
}

function getTextContent(element: HTMLElement): string {
	return element.textContent || "";
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/**
 * Convert Markdown to HTML safely and efficiently
 */
export function markdownToHtml(markdown: string): string {
	if (!markdown) return "";

	let content = markdown;

	// Code blocks (extract to placeholders to avoid mangling code content)
	const codeBlocks: string[] = [];
	content = content.replace(/```([\s\S]*?)```/g, (_, code) => {
		const placeholder = `XCODEBLOCKX${codeBlocks.length}X`;
		codeBlocks.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`);
		return placeholder;
	});

	// Inline code
	const inlineCodes: string[] = [];
	content = content.replace(/`([^`]+)`/g, (_, code) => {
		const placeholder = `XINLINECODEX${inlineCodes.length}X`;
		inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
		return placeholder;
	});

	// Escape raw HTML before converting markdown
	content = escapeHtml(content);

	// Headers
	content = content.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
	content = content.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
	content = content.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
	content = content.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
	content = content.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
	content = content.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

	// Bold & Italic
	content = content.replace(
		/\*\*\*(.+?)\*\*\*/g,
		"<strong><em>$1</em></strong>",
	);
	content = content.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
	content = content.replace(/__(.+?)__/g, "<strong>$1</strong>");
	content = content.replace(/\*(.+?)\*/g, "<em>$1</em>");
	content = content.replace(/_(.+?)_/g, "<em>$1</em>");

	// Strikethrough
	content = content.replace(/~~(.+?)~~/g, "<del>$1</del>");

	// Images & Links
	content = content.replace(
		/!\[(.*?)\]\((.*?)\)/g,
		'<img src="$2" alt="$1" />',
	);
	content = content.replace(
		/\[(.*?)\]\((.*?)\)/g,
		'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
	);

	// Blockquotes
	content = content.replace(/^&gt;\s+(.+)$/gm, "blockquote>$1</blockquote>");

	// Horizontal Rule
	content = content.replace(/^---$/gm, "<hr />");

	// Unordered lists
	content = content.replace(/^[\*\-\+]\s+(.+)$/gm, "<ul><li>$1</li></ul>");
	content = content.replace(/<\/ul>\s*<ul>/g, "");

	// Ordered lists
	content = content.replace(/^\d+\.\s+(.+)$/gm, "<ol><li>$1</li></ol>");
	content = content.replace(/<\/ol>\s*<ol>/g, "");

	// Paragraphs & Breaks
	content = content.replace(/\n\n+/g, "</p><p>");
	content = content.replace(/\n/g, "<br />");
	content = `<p>${content}</p>`;

	// Clean empty paragraphs created by block elements
	content = content
		.replace(/<p>\s*<(h[1-6]|ul|ol|pre|blockquote|hr)/gi, "<$1")
		.replace(/<\/(h[1-6]|ul|ol|pre|blockquote|hr)>\s*<\/p>/gi, "</$1>");

	// Restore code blocks and inline code
	inlineCodes.forEach((codeHtml, i) => {
		content = content.replace(`XINLINECODEX${i}X`, codeHtml);
	});
	codeBlocks.forEach((codeHtml, i) => {
		content = content.replace(`<p>XCODEBLOCKX${i}X</p>`, codeHtml);
		content = content.replace(`XCODEBLOCKX${i}X`, codeHtml);
	});

	return content;
}
