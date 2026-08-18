import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
	type ContractDocumentSection,
	type ContractDocumentView,
	ContractPaperDocument,
	contractClauseOutline,
	type PreviewParties,
	type PreviewTerms,
	splitContractClauseBody,
} from "@/components/project/ContractDocumentPreview";
import type {
	ContractClause,
	ContractPageInitial,
} from "@/services/contract.service";

/**
 * Where the viewport centre should move to when the zoom changes, so the spot
 * the reader was looking at stays under the centre.
 *
 * Pure, and exported, because the interesting part is arithmetic that is
 * miserable to verify by squinting at a zooming page: the document is NOT a
 * uniformly scaling surface. Page boxes scale; the column padding and the gaps
 * between pages do not. So `scrollTop * ratio` drifts — it stretches the fixed
 * chrome too, and the error compounds with every page above the centre.
 *
 * Instead: work out which page the old centre fell in (or which gap between
 * pages), keep that relative position, and rebuild the offset from the new page
 * height with the gaps left alone.
 */
export function remapZoomCentre(input: {
	centreY: number;
	centreX: number;
	/** Column padding above the first page. Does not scale. */
	padTop: number;
	/** Column padding left of a page while the content overflows. */
	padLeft: number;
	oldPageHeight: number;
	newPageHeight: number;
	/** Fixed space between consecutive pages. Does not scale. */
	gap: number;
	pageCount: number;
	/** newZoom / oldZoom. */
	ratio: number;
}): { centreY: number; centreX: number } {
	const {
		centreY,
		centreX,
		padTop,
		padLeft,
		oldPageHeight,
		newPageHeight,
		gap,
		pageCount,
		ratio,
	} = input;

	if (oldPageHeight <= 0 || newPageHeight <= 0) {
		return { centreY, centreX };
	}

	const oldPeriod = oldPageHeight + gap;
	const newPeriod = newPageHeight + gap;
	const into = centreY - padTop;
	// Clamped, so a centre above the first page or below the last still maps onto
	// a real page rather than extrapolating into empty space.
	const index = Math.max(
		0,
		Math.min(Math.max(pageCount - 1, 0), Math.floor(into / oldPeriod)),
	);
	// Clamped to one period as well as to a real page. Clamping only the index
	// is not enough: the leftover would keep the whole overshoot and leak it
	// through the gap term below, sending the centre thousands of pixels past
	// the end of the document.
	const withinPeriod = Math.min(
		Math.max(into - index * oldPeriod, 0),
		oldPeriod,
	);
	const withinPage = Math.min(withinPeriod, oldPageHeight);
	// Anything past the page bottom was in the gap, which does not scale.
	const withinGap = Math.min(Math.max(withinPeriod - oldPageHeight, 0), gap);

	return {
		centreY:
			padTop +
			index * newPeriod +
			(withinPage / oldPageHeight) * newPageHeight +
			withinGap,
		// Horizontal has no gaps, so it is a straight scale about the left padding.
		centreX: padLeft + (centreX - padLeft) * ratio,
	};
}

export const A4_WIDTH_PX = 794;
export const A4_HEIGHT_PX = 1123;
// The large paper uses `py-12` (48 px on each edge). Keep the paginator's
// usable height in lockstep with that physical page padding.
const PAPER_PADDING_Y = 96;
const PAGE_CONTENT_HEIGHT = A4_HEIGHT_PX - PAPER_PADDING_Y;

export interface MeasuredContractBlock {
	id: string;
	height: number;
}

/**
 * Packs measured semantic blocks into A4 content areas. Keeping this pure makes
 * the page-breaking rules deterministic and testable independently of the DOM.
 */
export function paginateContractBlocks(
	blocks: MeasuredContractBlock[],
	capacity = PAGE_CONTENT_HEIGHT,
): string[][] {
	if (blocks.length === 0) return [[]];

	const pages: string[][] = [];
	let page: string[] = [];
	let used = 0;

	for (const block of blocks) {
		const height = Math.max(0, block.height);
		if (page.length > 0 && used + height > capacity) {
			pages.push(page);
			page = [];
			used = 0;
		}
		page.push(block.id);
		used += height;
	}

	if (page.length > 0) pages.push(page);
	return pages.length > 0 ? pages : [[]];
}

function contractBlockIds(contract: ContractDocumentView): string[] {
	return [
		"header",
		"parties",
		"terms",
		...(contract.services.length > 0 ? ["services"] : []),
		...contractClauseOutline(contract.clauses).flatMap(({ clause }) =>
			splitContractClauseBody(clause.body).map(
				(_, index) => `clause:${clause.key}:${index}`,
			),
		),
		"signatures",
	];
}

function samePages(left: string[][], right: string[][]): boolean {
	return (
		left.length === right.length &&
		left.every(
			(page, index) =>
				page.length === right[index]?.length &&
				page.every((id, itemIndex) => id === right[index]?.[itemIndex]),
		)
	);
}

function countWords(
	contract: ContractDocumentView,
	parties: PreviewParties,
	terms: PreviewTerms,
): number {
	const text = [
		parties.provider_name,
		parties.provider_address,
		parties.client_name,
		parties.client_contact_name,
		parties.client_address,
		terms.service_description,
		...contract.services.flatMap((service) => [
			service.name,
			service.description ?? "",
		]),
		...contract.clauses.flatMap((clause) => [clause.title, clause.body]),
	].join(" ");
	return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export interface ContractCanvasStats {
	currentPage: number;
	pageCount: number;
	wordCount: number;
}

export function ContractEditorCanvas({
	contract,
	parties,
	terms,
	activeSection,
	onSectionSelect,
	editable,
	onClauseChange,
	selectable = true,
	zoom,
	onZoomChange,
	fitSignal,
	onStatsChange,
	pageInitials = [],
}: {
	contract: ContractDocumentView;
	parties: PreviewParties;
	terms: PreviewTerms;
	activeSection?: ContractDocumentSection;
	onSectionSelect?: (section: ContractDocumentSection) => void;
	editable: boolean;
	onClauseChange?: (
		key: string,
		patch: Partial<Pick<ContractClause, "title" | "body">>,
	) => void;
	/** Public readers use the same A4 canvas without editor selection chrome. */
	selectable?: boolean;
	zoom: number;
	onZoomChange: (zoom: number) => void;
	fitSignal: number;
	/** Per-page marks, stamped into each page's footer. */
	pageInitials?: ContractPageInitial[];
	onStatsChange?: (stats: ContractCanvasStats) => void;
}) {
	const canvasRef = useRef<HTMLDivElement>(null);
	const measurementRef = useRef<HTMLDivElement>(null);
	const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
	const ids = useMemo(() => contractBlockIds(contract), [contract]);
	const [pages, setPages] = useState<string[][]>(() => [ids]);
	const [currentPage, setCurrentPage] = useState(1);
	const wordCount = useMemo(
		() => countWords(contract, parties, terms),
		[contract, parties, terms],
	);

	useEffect(() => {
		setPages((current) => {
			const currentIds = new Set(current.flat());
			return ids.length === currentIds.size &&
				ids.every((id) => currentIds.has(id))
				? current
				: [ids];
		});
	}, [ids]);

	useLayoutEffect(() => {
		const measurement = measurementRef.current;
		if (!measurement) return;

		let frame = 0;
		const measure = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const blocks = Array.from(
					measurement.querySelectorAll<HTMLElement>("[data-contract-block]"),
				).map((element) => ({
					id: element.dataset.contractBlock ?? "",
					height: element.getBoundingClientRect().height,
				}));
				const next = paginateContractBlocks(blocks.filter((block) => block.id));
				setPages((current) => (samePages(current, next) ? current : next));
			});
		};

		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(measurement);
		void document.fonts?.ready.then(measure);
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
		};
	}, [contract, parties, terms, editable, selectable]);

	useEffect(() => {
		const root = canvasRef.current;
		if (!root) return;
		const observer = new IntersectionObserver(
			(entries) => {
				const visible = entries
					.filter((entry) => entry.isIntersecting)
					.sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
				if (visible) {
					setCurrentPage(
						Number((visible.target as HTMLElement).dataset.page) + 1,
					);
				}
			},
			{ root, threshold: [0.2, 0.4, 0.6] },
		);
		for (const page of pageRefs.current) if (page) observer.observe(page);
		return () => observer.disconnect();
	}, [pages, zoom]);

	useEffect(() => {
		onStatsChange?.({
			currentPage: Math.min(currentPage, pages.length),
			pageCount: pages.length,
			wordCount,
		});
	}, [currentPage, pages.length, wordCount, onStatsChange]);

	useEffect(() => {
		if (fitSignal === 0) return;
		const width = canvasRef.current?.clientWidth ?? 0;
		if (width <= 0) return;
		const fitted = Math.floor(((width - 64) / A4_WIDTH_PX) * 100);
		onZoomChange(Math.max(30, Math.min(100, fitted)));
	}, [fitSignal, onZoomChange]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const handleWheelZoom = (event: WheelEvent) => {
			if (!(event.ctrlKey || event.metaKey)) return;
			// React's delegated wheel event may be passive in Chromium. A native,
			// explicitly non-passive listener is required to stop browser-page zoom.
			event.preventDefault();
			event.stopPropagation();
			const delta = event.deltaY < 0 ? 10 : -10;
			onZoomChange(Math.max(30, Math.min(200, zoom + delta)));
		};
		canvas.addEventListener("wheel", handleWheelZoom, { passive: false });
		return () => canvas.removeEventListener("wheel", handleWheelZoom);
	}, [zoom, onZoomChange]);

	/**
	 * Keep whatever sits at the centre of the viewport there when zoom changes.
	 *
	 * `transform-origin` cannot do this. The origin decides where a page scales
	 * about inside its own box; what makes zoom feel anchored is the SCROLL
	 * position of the canvas, because the canvas is the scroll container. Without
	 * this, zooming walks towards the top of the document — the content grows
	 * below a fixed scrollTop, so the thing you were reading slides away.
	 *
	 * Reacting to the `zoom` prop rather than hooking each control on purpose:
	 * zoom arrives from the wheel handler, the keyboard shortcuts, the fit
	 * effect and the parent's toolbar, and only one of those is in this file.
	 *
	 * Runs as a layout effect so the scroll correction lands in the same frame
	 * as the resize; in an ordinary effect the un-anchored frame is visible.
	 */
	const previousZoomRef = useRef(zoom);
	useLayoutEffect(() => {
		const canvas = canvasRef.current;
		const previousZoom = previousZoomRef.current;
		previousZoomRef.current = zoom;
		if (!canvas || previousZoom === zoom || previousZoom <= 0) return;

		const firstPage = pageRefs.current[0];
		if (!firstPage) return;

		// Padding and the inter-page gap do NOT scale with zoom, so they are read
		// back from the freshly laid-out DOM instead of being duplicated from the
		// Tailwind classes below — where they would silently go stale.
		const padTop = firstPage.offsetTop;
		const newPageHeight = firstPage.offsetHeight;
		const secondPage = pageRefs.current[1];
		const gap = secondPage
			? secondPage.offsetTop - (firstPage.offsetTop + newPageHeight)
			: 0;
		const oldPageHeight = A4_HEIGHT_PX * (previousZoom / 100);
		if (oldPageHeight <= 0 || newPageHeight <= 0) return;

		const { centreY: nextCentreY, centreX: nextCentreX } = remapZoomCentre({
			centreY: canvas.scrollTop + canvas.clientHeight / 2,
			centreX: canvas.scrollLeft + canvas.clientWidth / 2,
			padTop,
			padLeft: firstPage.offsetLeft,
			oldPageHeight,
			newPageHeight,
			gap,
			pageCount: pages.length,
			ratio: zoom / previousZoom,
		});

		const clamp = (value: number, max: number) =>
			Math.max(0, Math.min(value, Math.max(0, max)));
		canvas.scrollTop = clamp(
			nextCentreY - canvas.clientHeight / 2,
			canvas.scrollHeight - canvas.clientHeight,
		);
		canvas.scrollLeft = clamp(
			nextCentreX - canvas.clientWidth / 2,
			canvas.scrollWidth - canvas.clientWidth,
		);
	}, [zoom, pages.length]);

	const adjustZoom = (delta: number) =>
		onZoomChange(Math.max(30, Math.min(200, zoom + delta)));

	return (
		<>
			<div
				ref={canvasRef}
				tabIndex={0}
				onKeyDown={(event) => {
					if (!(event.ctrlKey || event.metaKey)) return;
					if (event.key === "+" || event.key === "=") {
						event.preventDefault();
						adjustZoom(10);
					} else if (event.key === "-") {
						event.preventDefault();
						adjustZoom(-10);
					} else if (event.key === "0") {
						event.preventDefault();
						onZoomChange(100);
					}
				}}
				// A document editor's desk is a fixed neutral by design — it must not
				// follow the app theme, or the paper would stop reading as paper.
				className="hide-scrollbar relative h-full overflow-auto bg-slate-200/80 outline-none dark:bg-slate-950"
				aria-label="Contract document canvas"
			>
				<div className="flex min-h-full min-w-max flex-col items-center gap-7 px-8 py-10">
					{pages.map((page, index) => {
						const scale = zoom / 100;
						// Two boxes per page, and the pairing matters. The outer one is
						// pre-scaled and is what layout and the IntersectionObserver see;
						// the inner one is always full A4 and is scaled visually. The
						// transform origin has to match where the inner box actually sits
						// inside the outer, or the scaled page drifts out of its slot — so
						// `center center` is paired with centring it via flex.
						return (
							<div
								key={`${index}-${page.join("|")}`}
								ref={(element) => {
									pageRefs.current[index] = element;
								}}
								data-page={index}
								className="flex items-center justify-center"
								style={{
									width: A4_WIDTH_PX * scale,
									height: A4_HEIGHT_PX * scale,
								}}
							>
								<div
									className="relative shrink-0 overflow-hidden bg-white shadow-[0_8px_28px_rgba(15,23,42,0.24)] ring-1 ring-slate-900/15"
									style={{
										width: A4_WIDTH_PX,
										height: A4_HEIGHT_PX,
										transform: `scale(${scale})`,
										transformOrigin: "center center",
									}}
								>
									<ContractPaperDocument
										contract={contract}
										parties={parties}
										terms={terms}
										large
										blockIds={new Set(page)}
										activeSection={selectable ? activeSection : undefined}
										onSectionSelect={selectable ? onSectionSelect : undefined}
										editable={editable}
										onClauseChange={onClauseChange}
									/>
									<PageInitials
										initials={pageInitials.filter(
											(mark) => mark.page_index === index,
										)}
									/>
									<span className="absolute right-16 bottom-8 text-[10px] tabular-nums text-slate-400">
										{index + 1} / {pages.length}
									</span>
								</div>
							</div>
						);
					})}
				</div>
			</div>

			<div
				ref={measurementRef}
				aria-hidden="true"
				className="pointer-events-none fixed top-0 -left-[10000px] opacity-0"
				style={{ width: A4_WIDTH_PX }}
			>
				{/* Pagination must measure the exact editor geometry. Without these
				    props, measurement omitted the region borders/padding and editable
				    clause padding, so later clauses were assigned to a page whose visible
				    A4 area could not actually contain them. */}
				<ContractPaperDocument
					contract={contract}
					parties={parties}
					terms={terms}
					large
					onSectionSelect={selectable ? () => undefined : undefined}
					editable={editable}
					onClauseChange={() => undefined}
				/>
			</div>
		</>
	);
}

/**
 * The initials footer on one page.
 *
 * Sits in the bottom margin, opposite the page number, where every e-signature
 * product puts it — inside the page so it prints, outside the text block so it
 * never collides with a clause. A page nobody has initialled shows nothing
 * rather than an empty placeholder box, so an unsigned draft still reads as a
 * clean document.
 */
function PageInitials({ initials }: { initials: ContractPageInitial[] }) {
	if (initials.length === 0) return null;
	const seat = (position: "hirer" | "provider") =>
		initials.find((mark) => mark.position === position);
	const provider = seat("provider");
	const hirer = seat("hirer");

	return (
		<div className="absolute bottom-6 left-16 flex items-end gap-6">
			{[
				{ label: "Provider", mark: provider },
				{ label: "Client", mark: hirer },
			]
				.filter((entry) => entry.mark)
				.map((entry) => (
					<div key={entry.label} className="flex flex-col items-center gap-0.5">
						<img
							src={entry.mark?.image_url}
							alt={`${entry.label} initials`}
							className="h-7 w-auto object-contain"
						/>
						<span className="border-t border-slate-300 px-3 text-[8px] uppercase tracking-wider text-slate-400">
							{entry.label}
						</span>
					</div>
				))}
		</div>
	);
}
