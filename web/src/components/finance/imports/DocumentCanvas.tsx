import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface SnipRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface CanvasSnip {
	field_key: string;
	page: number;
	rect: SnipRect;
}

/**
 * The source document, with drag-to-snip over it.
 *
 * PDFs render through pdf.js to a canvas; images render as themselves. Either
 * way the overlay works in FRACTIONS of the rendered page, never pixels — the
 * same drag has to mean the same region when the page is re-rendered at a
 * different width, on a different screen, months later.
 *
 * The worker is imported with Vite's `?url` so it is bundled and served from
 * this origin. pdf.js otherwise reaches for a CDN copy, which would be a
 * third-party script executing over commercial documents.
 */
let workerConfigured = false;

async function loadPdfjs() {
	const pdfjs = await import("pdfjs-dist");
	if (!workerConfigured) {
		const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url"))
			.default;
		pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
		workerConfigured = true;
	}
	return pdfjs;
}

export function DocumentCanvas({
	bytes,
	mimeType,
	page,
	snips,
	activeField,
	onPageCount,
	onSnip,
}: {
	bytes: ArrayBuffer | null;
	mimeType: string;
	page: number;
	snips: CanvasSnip[];
	/** The field a drag will fill. Snipping is off when nothing is selected. */
	activeField: string | null;
	onPageCount: (count: number) => void;
	/** `text` is what the PDF's own text layer says inside the region, if any. */
	onSnip: (rect: SnipRect, text: string) => void;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const surfaceRef = useRef<HTMLDivElement>(null);
	// Kept from the render so a snip can ask the page what text it covered.
	const pageRef = useRef<{
		page: { getTextContent: () => Promise<{ items: unknown[] }> };
		viewport: { width: number; height: number; transform: number[] };
	} | null>(null);
	const [imageUrl, setImageUrl] = useState<string | null>(null);
	const [rendering, setRendering] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [drag, setDrag] = useState<SnipRect | null>(null);

	const isPdf = mimeType === "application/pdf";

	// An image needs no renderer, only an object URL — revoked on swap so a long
	// session does not hold every document it opened in memory.
	useEffect(() => {
		if (isPdf || !bytes) return;
		const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
		setImageUrl(url);
		setRendering(false);
		onPageCount(1);
		return () => URL.revokeObjectURL(url);
	}, [bytes, isPdf, mimeType, onPageCount]);

	useEffect(() => {
		if (!isPdf || !bytes) return;
		let cancelled = false;
		setRendering(true);
		setError(null);

		void (async () => {
			try {
				const pdfjs = await loadPdfjs();
				// pdf.js takes ownership of the buffer it is handed, so it gets a
				// copy: the original is reused every time the page changes.
				const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
				if (cancelled) return;
				onPageCount(doc.numPages);

				const pdfPage = await doc.getPage(Math.min(page, doc.numPages));
				if (cancelled) return;
				const canvas = canvasRef.current;
				const context = canvas?.getContext("2d");
				if (!canvas || !context) return;

				// Render at the surface's own width, then again at device pixel
				// ratio, so text stays sharp on a retina screen without the CSS box
				// changing size (which would move every snip).
				const cssWidth = surfaceRef.current?.clientWidth ?? 800;
				const base = pdfPage.getViewport({ scale: 1 });
				const scale = cssWidth / base.width;
				const ratio = window.devicePixelRatio || 1;
				const viewport = pdfPage.getViewport({ scale: scale * ratio });

				canvas.width = viewport.width;
				canvas.height = viewport.height;
				canvas.style.width = `${cssWidth}px`;
				canvas.style.height = `${viewport.height / ratio}px`;
				pageRef.current = { page: pdfPage, viewport };
				await pdfPage.render({ canvas, canvasContext: context, viewport })
					.promise;
				if (!cancelled) setRendering(false);
			} catch (renderError) {
				if (cancelled) return;
				setError(
					renderError instanceof Error
						? renderError.message
						: "This document could not be rendered.",
				);
				setRendering(false);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [bytes, isPdf, page, onPageCount]);

	/** Pointer position as a fraction of the rendered page. */
	const fractionAt = useCallback((event: React.PointerEvent): SnipRect => {
		const bounds = surfaceRef.current?.getBoundingClientRect();
		if (!bounds) return { x: 0, y: 0, w: 0, h: 0 };
		return {
			x: (event.clientX - bounds.left) / bounds.width,
			y: (event.clientY - bounds.top) / bounds.height,
			w: 0,
			h: 0,
		};
	}, []);

	const startRef = useRef<SnipRect | null>(null);

	const onPointerDown = (event: React.PointerEvent) => {
		if (!activeField) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		const start = fractionAt(event);
		startRef.current = start;
		setDrag(start);
	};

	const onPointerMove = (event: React.PointerEvent) => {
		const start = startRef.current;
		if (!start || !activeField) return;
		const current = fractionAt(event);
		setDrag({
			x: Math.min(start.x, current.x),
			y: Math.min(start.y, current.y),
			w: Math.abs(current.x - start.x),
			h: Math.abs(current.y - start.y),
		});
	};

	const onPointerUp = () => {
		const rect = drag;
		startRef.current = null;
		setDrag(null);
		// A click is not a snip: anything under half a percent of the page is a
		// misfire, and committing it would highlight an invisible sliver.
		if (!rect || !activeField || rect.w < 0.005 || rect.h < 0.005) return;
		void (async () => onSnip(rect, await textInside(rect)))();
	};

	/**
	 * What the page itself says inside the region.
	 *
	 * This is the difference between a highlight and a snip: the value is read
	 * off the document's own text layer rather than retyped, so the recorded
	 * figure and the document cannot disagree. Images have no text layer and
	 * return nothing — their snip is evidence for a value typed beside it.
	 */
	const textInside = useCallback(
		async (rect: SnipRect): Promise<string> => {
			const current = pageRef.current;
			if (!isPdf || !current) return "";
			try {
				const { items } = await current.page.getTextContent();
				const { width, height } = current.viewport;
				const inside: Array<{ x: number; y: number; str: string }> = [];

				for (const raw of items) {
					const item = raw as {
						str?: string;
						width?: number;
						height?: number;
						transform?: number[];
					};
					if (!item.str?.trim() || !item.transform) continue;
					// transform[4]/[5] are the item's baseline origin in viewport pixels.
					const left = item.transform[4] / width;
					const bottom = item.transform[5] / height;
					const top = bottom - (item.height ?? 0) / height;
					const right = left + (item.width ?? 0) / width;
					const overlaps =
						right > rect.x &&
						left < rect.x + rect.w &&
						bottom > rect.y &&
						top < rect.y + rect.h;
					if (overlaps) inside.push({ x: left, y: top, str: item.str });
				}

				return inside
					.sort((a, b) => (Math.abs(a.y - b.y) > 0.01 ? a.y - b.y : a.x - b.x))
					.map((item) => item.str.trim())
					.join(" ")
					.replace(/\s+/g, " ")
					.trim();
			} catch {
				return "";
			}
		},
		[isPdf],
	);

	const pageSnips = snips.filter((snip) => snip.page === page);

	return (
		<div className="relative w-full">
			<div
				ref={surfaceRef}
				className={`relative w-full select-none overflow-hidden rounded-lg border border-border bg-card ${
					activeField ? "cursor-crosshair" : "cursor-default"
				}`}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
			>
				{isPdf ? (
					<canvas ref={canvasRef} className="block w-full" />
				) : imageUrl ? (
					<img
						src={imageUrl}
						alt="Uploaded document"
						className="block w-full"
						draggable={false}
					/>
				) : null}

				{pageSnips.map((snip) => (
					<span
						key={snip.field_key}
						aria-hidden="true"
						className="pointer-events-none absolute rounded-sm border-2 border-primary/70 bg-primary/15"
						style={{
							left: `${snip.rect.x * 100}%`,
							top: `${snip.rect.y * 100}%`,
							width: `${snip.rect.w * 100}%`,
							height: `${snip.rect.h * 100}%`,
						}}
					/>
				))}

				{drag && (
					<span
						aria-hidden="true"
						className="pointer-events-none absolute rounded-sm border-2 border-dashed border-primary bg-primary/10"
						style={{
							left: `${drag.x * 100}%`,
							top: `${drag.y * 100}%`,
							width: `${drag.w * 100}%`,
							height: `${drag.h * 100}%`,
						}}
					/>
				)}

				{rendering && (
					<div className="flex h-64 items-center justify-center">
						<Loader2 className="h-5 w-5 animate-spin text-primary" />
					</div>
				)}
			</div>

			{error && (
				<p className="mt-2 text-sm text-destructive-foreground">{error}</p>
			)}
		</div>
	);
}
