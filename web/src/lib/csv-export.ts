/**
 * Client-side CSV download.
 *
 * Finance data leaves this product one way today — by being retyped into a
 * spreadsheet. The rows are already in the browser, so the export needs no
 * endpoint; it just needs to be quoted correctly and to not hand Excel
 * something it will execute.
 */

export interface CsvColumn<T> {
	header: string;
	value: (row: T) => string | number | null | undefined;
}

/**
 * Excel and Sheets treat a leading `=`, `+`, `-` or `@` as the start of a
 * formula, so a supplier name like "=cmd|..." becomes an injection vector the
 * moment someone opens the file. Prefixing with a single quote neutralises it
 * while still displaying the original text.
 */
function neutralize(value: string): string {
	return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function escapeCell(value: string | number | null | undefined): string {
	if (value === null || value === undefined) return "";
	const text = neutralize(String(value));
	// Quote whenever the cell could otherwise break the row apart.
	return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
	const lines = [columns.map((column) => escapeCell(column.header)).join(",")];
	for (const row of rows) {
		lines.push(
			columns.map((column) => escapeCell(column.value(row))).join(","),
		);
	}
	// CRLF is what Excel expects; a BOM keeps non-ASCII names intact there too.
	return `﻿${lines.join("\r\n")}\r\n`;
}

export function downloadCsv(filename: string, csv: string): void {
	const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.append(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
