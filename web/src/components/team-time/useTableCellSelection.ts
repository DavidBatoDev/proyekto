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

// Walk up the DOM from the element under the cursor to find data-cell-key
function keyFromPoint(x: number, y: number): string | null {
	let node: Element | null = document.elementFromPoint(x, y);
	while (node) {
		const k = node.getAttribute("data-cell-key");
		if (k) return k;
		node = node.parentElement;
	}
	return null;
}

// bg-blue-100
const SELECTION_BG = "rgb(219 234 254)";

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
	// React state — only updated on commit (mouseup / click / shift-click / ctrl-click)
	// Never updated mid-drag, so the table never re-renders during a drag.
	const [selectedCells, setSelectedCellsState] = useState<Set<CellKey>>(
		new Set(),
	);

	// Ref mirrors so event handlers always see current values without stale closures
	const selectedCellsRef = useRef<Set<CellKey>>(selectedCells);
	selectedCellsRef.current = selectedCells;

	const rowIdsRef = useRef(orderedRowIds);
	rowIdsRef.current = orderedRowIds;
	const colIdsRef = useRef(orderedColIds);
	colIdsRef.current = orderedColIds;

	// Drag state — all refs, zero React renders during drag
	const isDraggingRef = useRef(false);
	const anchorRef = useRef<CellKey | null>(null);
	const baseSelectionRef = useRef<Set<CellKey>>(new Set());
	const mouseXRef = useRef(0);
	const mouseYRef = useRef(0);
	const scrollRafRef = useRef<number | null>(null);
	// The scrollable ancestor — resolved once per drag start
	const scrollerRef = useRef<Element | null>(null);
	// Time-based acceleration multiplier — increases each frame while in scroll zone
	const scrollAccelRef = useRef(1);

	// Apply highlight directly to DOM cells, diffing against previously selected set
	const applyDomSelection = useCallback(
		(next: Set<CellKey>) => {
			const table = tableRef.current;
			if (!table) return;
			// Remove cells no longer in the selection
			for (const el of table.querySelectorAll<HTMLElement>("[data-selected]")) {
				if (!next.has(el.getAttribute("data-cell-key") ?? "")) {
					el.removeAttribute("data-selected");
					el.style.backgroundColor = "";
				}
			}
			// Add newly selected cells
			for (const key of next) {
				const el = table.querySelector<HTMLElement>(
					`[data-cell-key="${key}"]`,
				);
				if (el && !el.hasAttribute("data-selected")) {
					el.setAttribute("data-selected", "true");
					el.style.backgroundColor = SELECTION_BG;
				}
			}
		},
		[tableRef],
	);

	// Strip DOM attrs and hand styling back to React className
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
		// Walk up the DOM to find the nearest scrollable ancestor
		function findScroller(el: Element): Element | null {
			let node: Element | null = el.parentElement;
			while (node && node !== document.documentElement) {
				const style = window.getComputedStyle(node);
				const oy = style.overflowY;
				if ((oy === "auto" || oy === "scroll") && node.scrollHeight > node.clientHeight) {
					return node;
				}
				node = node.parentElement;
			}
			return null;
		}

		// Scroll the resolved container (or window as fallback) and return pixels actually scrolled
		function doScroll(px: number) {
			const s = scrollerRef.current;
			if (s) {
				const before = s.scrollTop;
				s.scrollTop += px;
				return s.scrollTop - before;
			}
			window.scrollBy(0, px);
			return px;
		}

		// Base speed from mouse position alone (non-zero the moment the zone is entered).
		// Returns 0 when the cursor is comfortably inside the scroller.
		function getBaseSpeed(): number {
			const ZONE = 100; // px from scroller edge that activates scroll
			const ENTRY = 5;  // px/frame the instant the mouse enters the zone
			const EDGE = 30;  // px/frame at the scroller edge (before acceleration)
			const OVER = 60;  // px/frame baseline when mouse leaves the scroller rect

			const s = scrollerRef.current;
			let top = 0;
			let bottom = window.innerHeight;
			if (s) {
				const r = s.getBoundingClientRect();
				top = r.top;
				bottom = r.bottom;
			}

			const y = mouseYRef.current;
			const fromTop = y - top;
			const fromBottom = bottom - y;

			// Outside the scroller rect — strong constant overdrive
			if (y < top) return -(OVER + Math.abs(y - top) * 0.8);
			if (y > bottom) return OVER + (y - bottom) * 0.8;

			// Inside the zone — linear ramp from ENTRY to EDGE
			if (fromTop < ZONE) {
				const t = 1 - fromTop / ZONE; // 0 at zone boundary, 1 at edge
				return -(ENTRY + (EDGE - ENTRY) * t);
			}
			if (fromBottom < ZONE) {
				const t = 1 - fromBottom / ZONE;
				return ENTRY + (EDGE - ENTRY) * t;
			}
			return 0;
		}

		const scrollTick = () => {
			if (!isDraggingRef.current) {
				scrollRafRef.current = null;
				scrollAccelRef.current = 1;
				return;
			}

			const base = getBaseSpeed();

			if (base !== 0) {
				// Compound acceleration: each frame in the zone multiplies speed by 1.04
				// (doubles roughly every 18 frames / ~300 ms), capped at 12×
				scrollAccelRef.current = Math.min(12, scrollAccelRef.current * 1.04);
				doScroll(base * scrollAccelRef.current);

				// Re-evaluate selection from the cursor position after the scroll moved things
				if (anchorRef.current) {
					const key = keyFromPoint(mouseXRef.current, mouseYRef.current);
					if (key) {
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
				}
			} else {
				// Cursor moved back inside — reset so the next zone entry starts fresh
				scrollAccelRef.current = 1;
			}

			scrollRafRef.current = requestAnimationFrame(scrollTick);
		};

		let selRafId: number | null = null;
		let pendingKey: string | null = null;

		const onMouseDown = (e: MouseEvent) => {
			if (e.button !== 0) return;
			const target = e.target as HTMLElement;

			// Click outside table → clear
			if (!tableRef.current?.contains(target)) {
				commitSelection(new Set());
				anchorRef.current = null;
				baseSelectionRef.current = new Set();
				return;
			}
			// Don't intercept interactive elements inside cells
			if (
				target.closest("button") ||
				target.closest("input") ||
				target.closest("a")
			)
				return;

			const key = keyFromPoint(e.clientX, e.clientY);
			if (!key) return;

			// Resolve the scroll container once per drag
			scrollerRef.current = tableRef.current ? findScroller(tableRef.current) : null;

			e.preventDefault();
			mouseXRef.current = e.clientX;
			mouseYRef.current = e.clientY;

			if (e.shiftKey && anchorRef.current) {
				// Extend range from anchor without starting a new drag
				const rect = getRectRange(
					anchorRef.current,
					key,
					rowIdsRef.current,
					colIdsRef.current,
				);
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

			if (scrollRafRef.current === null) {
				scrollRafRef.current = requestAnimationFrame(scrollTick);
			}
		};

		const onMouseMove = (e: MouseEvent) => {
			mouseXRef.current = e.clientX;
			mouseYRef.current = e.clientY;
			if (!isDraggingRef.current || !anchorRef.current) return;

			const key = keyFromPoint(e.clientX, e.clientY);
			if (!key || key === pendingKey) return;
			pendingKey = key;

			// Throttle DOM updates to one per animation frame
			if (selRafId !== null) return;
			selRafId = requestAnimationFrame(() => {
				selRafId = null;
				if (!pendingKey || !anchorRef.current) return;
				const rect = getRectRange(
					anchorRef.current,
					pendingKey,
					rowIdsRef.current,
					colIdsRef.current,
				);
				const merged = new Set(baseSelectionRef.current);
				for (const k of rect) merged.add(k);
				applyDomSelection(merged);
			});
		};

		const onMouseUp = () => {
			if (!isDraggingRef.current) return;
			isDraggingRef.current = false;

			// Harvest final selection from DOM attrs + base (ctrl-click accumulation)
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
			if (scrollRafRef.current !== null)
				cancelAnimationFrame(scrollRafRef.current);
			if (selRafId !== null) cancelAnimationFrame(selRafId);
		};
	}, [tableRef, applyDomSelection, commitSelection]);

	const clearSelection = useCallback(() => {
		commitSelection(new Set());
		anchorRef.current = null;
		baseSelectionRef.current = new Set();
	}, [commitSelection]);

	const isSelected = useCallback(
		(rowId: string, colId: string) =>
			selectedCells.has(makeCellKey(rowId, colId)),
		[selectedCells],
	);

	const getCellDataProps = useCallback(
		(rowId: string, colId: string) => ({
			"data-cell-key": makeCellKey(rowId, colId),
		}),
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
