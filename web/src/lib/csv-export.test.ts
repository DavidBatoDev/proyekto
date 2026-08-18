import { describe, expect, it } from "vitest";
import { type CsvColumn, toCsv } from "./csv-export";

interface Row {
	name: string;
	total: number | null;
}

const columns: CsvColumn<Row>[] = [
	{ header: "Name", value: (row) => row.name },
	{ header: "Total", value: (row) => row.total },
];

function body(csv: string): string[] {
	// Drop the BOM and the trailing blank produced by the final CRLF.
	return csv.replace(/^﻿/, "").split("\r\n").slice(0, -1);
}

describe("toCsv", () => {
	it("quotes cells containing a delimiter, quote, or newline", () => {
		const csv = toCsv(
			[
				{ name: "Acme, Inc.", total: 1 },
				{ name: 'He said "hi"', total: 2 },
				{ name: "line\nbreak", total: 3 },
			],
			columns,
		);
		expect(body(csv)).toEqual([
			"Name,Total",
			'"Acme, Inc.",1',
			'"He said ""hi""",2',
			'"line\nbreak",3',
		]);
	});

	it("neutralises cells a spreadsheet would run as a formula", () => {
		const csv = toCsv(
			[
				{ name: "=1+1", total: 0 },
				{ name: "+SUM(A1)", total: 0 },
				{ name: "-2", total: 0 },
				{ name: "@import", total: 0 },
			],
			columns,
		);
		expect(body(csv).slice(1)).toEqual([
			"'=1+1,0",
			"'+SUM(A1),0",
			"'-2,0",
			"'@import,0",
		]);
	});

	it("writes an empty cell for null and undefined", () => {
		const csv = toCsv([{ name: "x", total: null }], columns);
		expect(body(csv)[1]).toBe("x,");
	});

	it("emits a header row even with no data", () => {
		expect(body(toCsv([], columns))).toEqual(["Name,Total"]);
	});
});
