import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

type CellKey = string; // `${rowId}:${colId}`

function makeCellKey(rowId: string, colId: string): CellKey {
	return `${rowId}:${colId}`;
}

function getRectRange(
	from: CellKey,
	to: CellKey,
	orderedRowIds: string[],
	orderedColIds: string[],
): Set<CellKey> {
	const [fromRow, fromCol] = from.split(":");
	const [toRow, toCol] = to.split(":");
	const r1 = orderedRowIds.indexOf(fromRow);
	const r2 = orderedRowIds.indexOf(toRow);
	const c1 = orderedColIds.indexOf(fromCol);
	const c2 = orderedColIds.indexOf(toCol);
	if (r1 === -1 || r2 === -1 || c1 === -1 || c2 === -1) return new Set();

	const minR = Math.min(r1, r2);
	const maxR = Math.max(r1, r2);
	const minC = Math.min(c1, c2);
	const maxC = Math.max(c1, c2);

	const result = new Set<CellKey>();
	for (let r = minR; r <= maxR; r++) {
		for (let c = minC; c <= maxC; c++) {
			result.add(makeCellKey(orderedRowIds[r], orderedColIds[c]));
		}
	}
	return result;
}

function keyFromPoint(x: number, y: number): string | null {
	let node: Element | null = document.elementFromPoint(x, y);
	while (node) {
		const k = node.getAttribute("data-cell-key");
		if (k) return k;
		node = node.parentElement;
	}
	return null;
}

// Shared speed constants (same feel for both axes)
const ZONE = 100;  // px from edge that activates scroll
const ENTRY = 5;   // px/frame at zone boundary
const EDGE = 30;   // px/frame at the element edge (before accel)
const OVER = 60;   // px/frame when mouse is outside the element rect
const MAX_ACCEL = 12;
const ACCEL_RATE = 1.04; // multiplier per frame (~doubles every 18 frames / 300 ms)

function axisSpeed(
	mouse: number,
	edgeLow: number,
	edgeHigh: number,
): number {
	const fromLow = mouse - edgeLow;
	const fromHigh = edgeHigh - mouse;

	if (mouse < edgeLow)
		return -(OVER + Math.abs(mouse - edgeLow) * 0.8);
	if (mouse > edgeHigh)
		return OVER + (mouse - edgeHigh) * 0.8;
	if (fromLow < ZONE) {
		const t = 1 - fromLow / ZONE;
		return -(ENTRY + (EDGE - ENTRY) * t);
	}
	if (fromHigh < ZONE) {
		const t = 1 - fromHigh / ZONE;
		return ENTRY + (EDGE - ENTRY) * t;
	}
	return 0;
}

const SELECTION_BG = "rgb(219 234 254)"; // bg-blue-100

export interface TableCellSelectionResult {
	selectedCells: Set<CellKey>;
	hasSelection: boolean;
	isSelected: (rowId: string, colId: string) => boolean;
	getCellDataProps: (rowId: string, colId: string) => { "data-cell-key": string };
	clearSelection: () => void;
}

export function useTableCellSelection(
	orderedRowIds: string[],
	orderedColIds: string[],
	tableRef: RefObject<HTMLTableElement | null>,
): TableCellSelectionResult {
	const [selectedCells, setSelectedCellsState] = useState<Set<CellKey>>(new Set());

	const selectedCellsRef = useRef<Set<CellKey>>(selectedCells);
	selectedCellsRef.current = selectedCells;

	const rowIdsRef = useRef(orderedRowIds);
	rowIdsRef.current = orderedRowIds;
	const colIdsRef = useRef(orderedColIds);
	colIdsRef.current = orderedColIds;

	const isDraggingRef = useRef(false);
	const anchorRef = useRef<CellKey | null>(null);
	const baseSelectionRef = useRef<Set<CellKey>>(new Set());
	const mouseXRef = useRef(0);
	const mouseYRef = useRef(0);
	const scrollRafRef = useRef<number | null>(null);

	// Vertical scroller (page / overflow-y container)
	const vScrollerRef = useRef<Element | null>(null);
	// Horizontal scroller (the overflow-x-auto wrapper around the table)
	const hScrollerRef = useRef<Element | null>(null);

	// Independent acceleration for each axis
	const vAccelRef = useRef(1);
	const hAccelRef = useRef(1);

	const applyDomSelection = useCallback(
		(next: Set<CellKey>) => {
			const table = tableRef.current;
			if (!table) return;
			for (const el of table.querySelectorAll<HTMLElement>("[data-selected]")) {
				if (!next.has(el.getAttribute("data-cell-key") ?? "")) {
					el.removeAttribute("data-selected");
					el.style.backgroundColor = "";
				}
			}
			for (const key of next) {
				const el = table.querySelector<HTMLElement>(`[data-cell-key="${key}"]`);
				if (el && !el.hasAttribute("data-selected")) {
					el.setAttribute("data-selected", "true");
					el.style.backgroundColor = SELECTION_BG;
				}
			}
		},
		[tableRef],
	);

	const commitSelection = useCallback(
		(cells: Set<CellKey>) => {
			const table = tableRef.current;
			if (table) {
				for (const el of table.querySelectorAll<HTMLElement>("[data-selected]")) {
					el.removeAttribute("data-selected");
					el.style.backgroundColor = "";
				}
			}
			selectedCellsRef.current = cells;
			setSelectedCellsState(cells);
		},
		[tableRef],
	);

	useEffect(() => {
		function findVScroller(el: Element): Element | null {
			let node: Element | null = el.parentElement;
			while (node && node !== document.documentElement) {
				const s = window.getComputedStyle(node);
				if (
					(s.overflowY === "auto" || s.overflowY === "scroll") &&
					node.scrollHeight > node.clientHeight
				)
					return node;
				node = node.parentElement;
			}
			return null;
		}

		function findHScroller(el: Element): Element | null {
			let node: Element | null = el.parentElement;
			while (node && node !== document.documentElement) {
				const s = window.getComputedStyle(node);
				if (
					(s.overflowX === "auto" || s.overflowX === "scroll") &&
					node.scrollWidth > node.clientWidth
				)
					return node;
				node = node.parentElement;
			}
			return null;
		}

		function doScrollV(px: number) {
			const s = vScrollerRef.current;
			if (s) s.scrollTop += px;
			else window.scrollBy(0, px);
		}

		function doScrollH(px: number) {
			const s = hScrollerRef.current;
			if (s) s.scrollLeft += px;
			else window.scrollBy(px, 0);
		}

		function getVBounds() {
			const s = vScrollerRef.current;
			if (s) {
				const r = s.getBoundingClientRect();
				return { top: r.top, bottom: r.bottom };
			}
			return { top: 0, bottom: window.innerHeight };
		}

		function getHBounds() {
			const s = hScrollerRef.current;
			if (s) {
				const r = s.getBoundingClientRect();
				return { left: r.left, right: r.right };
			}
			return { left: 0, right: window.innerWidth };
		}

		function updateSelectionFromCursor() {
			if (!anchorRef.current) return;
			const key = keyFromPoint(mouseXRef.current, mouseYRef.current);
			if (!key) return;
			const rect = getRectRange(
				anchorRef.current,
				key,
				rowIdsRef.current,
				colIdsRef.current,
			);
			const merged = new Set(baseSelectionRef.current);
			for (const k of rect) merged.add(k);
			applyDomSelection(merged);
		}

		const scrollTick = () => {
			if (!isDraggingRef.current) {
				scrollRafRef.current = null;
				vAccelRef.current = 1;
				hAccelRef.current = 1;
				return;
			}

			const { top, bottom } = getVBounds();
			const { left, right } = getHBounds();
			const vBase = axisSpeed(mouseYRef.current, top, bottom);
			const hBase = axisSpeed(mouseXRef.current, left, right);

			let scrolled = false;

			if (vBase !== 0) {
				vAccelRef.current = Math.min(MAX_ACCEL, vAccelRef.current * ACCEL_RATE);
				doScrollV(vBase * vAccelRef.current);
				scrolled = true;
			} else {
				vAccelRef.current = 1;
			}

			if (hBase !== 0) {
				hAccelRef.current = Math.min(MAX_ACCEL, hAccelRef.current * ACCEL_RATE);
				doScrollH(hBase * hAccelRef.current);
				scrolled = true;
			} else {
				hAccelRef.current = 1;
			}

			if (scrolled) updateSelectionFromCursor();

			scrollRafRef.current = requestAnimationFrame(scrollTick);
		};

		let selRafId: number | null = null;
		let pendingKey: string | null = null;

		const onMouseDown = (e: MouseEvent) => {
			if (e.button !== 0) return;
			const target = e.target as HTMLElement;

			// Always let interactive elements handle their own events — this covers
			// both buttons inside the table and portal menus rendered in document.body.
			if (target.closest("button") || target.closest("input") || target.closest("a"))
				return;

			if (!tableRef.current?.contains(target)) {
				commitSelection(new Set());
				anchorRef.current = null;
				baseSelectionRef.current = new Set();
				return;
			}

			const key = keyFromPoint(e.clientX, e.clientY);
			if (!key) return;

			// Resolve scroll containers once per drag
			if (tableRef.current) {
				vScrollerRef.current = findVScroller(tableRef.current);
				hScrollerRef.current = findHScroller(tableRef.current);
			}

			e.preventDefault();
			mouseXRef.current = e.clientX;
			mouseYRef.current = e.clientY;

			if (e.shiftKey && anchorRef.current) {
				const rect = getRectRange(anchorRef.current, key, rowIdsRef.current, colIdsRef.current);
				const merged = new Set(baseSelectionRef.current);
				for (const k of rect) merged.add(k);
				commitSelection(merged);
				return;
			}

			isDraggingRef.current = true;

			if (e.ctrlKey || e.metaKey) {
				const next = new Set(selectedCellsRef.current);
				if (next.has(key)) next.delete(key);
				else next.add(key);
				baseSelectionRef.current = next;
				anchorRef.current = key;
				commitSelection(next);
			} else {
				baseSelectionRef.current = new Set();
				anchorRef.current = key;
				applyDomSelection(new Set([key]));
			}

			if (scrollRafRef.current === null)
				scrollRafRef.current = requestAnimationFrame(scrollTick);
		};

		const onMouseMove = (e: MouseEvent) => {
			mouseXRef.current = e.clientX;
			mouseYRef.current = e.clientY;
			if (!isDraggingRef.current || !anchorRef.current) return;

			const key = keyFromPoint(e.clientX, e.clientY);
			if (!key || key === pendingKey) return;
			pendingKey = key;

			if (selRafId !== null) return;
			selRafId = requestAnimationFrame(() => {
				selRafId = null;
				if (!pendingKey || !anchorRef.current) return;
				const rect = getRectRange(anchorRef.current, pendingKey, rowIdsRef.current, colIdsRef.current);
				const merged = new Set(baseSelectionRef.current);
				for (const k of rect) merged.add(k);
				applyDomSelection(merged);
			});
		};

		const onMouseUp = () => {
			if (!isDraggingRef.current) return;
			isDraggingRef.current = false;

			const table = tableRef.current;
			const final = new Set<CellKey>(baseSelectionRef.current);
			if (table) {
				for (const el of table.querySelectorAll<HTMLElement>("[data-selected]")) {
					const k = el.getAttribute("data-cell-key");
					if (k) final.add(k);
				}
			}
			commitSelection(final);
		};

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			isDraggingRef.current = false;
			if (scrollRafRef.current !== null) {
				cancelAnimationFrame(scrollRafRef.current);
				scrollRafRef.current = null;
			}
			commitSelection(new Set());
			anchorRef.current = null;
			baseSelectionRef.current = new Set();
		};

		document.addEventListener("mousedown", onMouseDown);
		document.addEventListener("mousemove", onMouseMove, { passive: true });
		document.addEventListener("mouseup", onMouseUp);
		document.addEventListener("keydown", onKeyDown);

		return () => {
			document.removeEventListener("mousedown", onMouseDown);
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
			document.removeEventListener("keydown", onKeyDown);
			if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
			if (selRafId !== null) cancelAnimationFrame(selRafId);
		};
	}, [tableRef, applyDomSelection, commitSelection]);

	const clearSelection = useCallback(() => {
		commitSelection(new Set());
		anchorRef.current = null;
		baseSelectionRef.current = new Set();
	}, [commitSelection]);

	const isSelected = useCallback(
		(rowId: string, colId: string) => selectedCells.has(makeCellKey(rowId, colId)),
		[selectedCells],
	);

	const getCellDataProps = useCallback(
		(rowId: string, colId: string) => ({ "data-cell-key": makeCellKey(rowId, colId) }),
		[],
	);

	return {
		selectedCells,
		hasSelection: selectedCells.size > 0,
		isSelected,
		getCellDataProps,
		clearSelection,
	};
}
