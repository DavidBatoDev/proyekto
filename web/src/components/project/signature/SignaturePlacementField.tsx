import { useEffect, useRef, useState } from "react";
import {
	clampSignatureOffset as clampOffset,
	SIGNATURE_BASE_HEIGHT_PX,
	SIGNATURE_FIELD_HEIGHT_PX,
	SIGNATURE_MAX_SCALE,
	SIGNATURE_MIN_SCALE,
} from "@/components/project/signature/signature-constants";
import {
	DEFAULT_SIGNATURE_PLACEMENT,
	type SignaturePlacement,
} from "@/services/contract.service";

/**
 * A signature field you can drag the signature around inside, the way a PDF
 * signer lets you nudge a stamp onto the printed signature line.
 *
 * The field's height is fixed and the image is an absolutely positioned
 * overlay on top of it, so neither resizing nor repositioning can change the
 * surrounding layout — which is what kept knocking the document's two
 * signature columns out of alignment.
 *
 * Offsets are stored in multiples of the base height rather than pixels, so
 * the same value renders correctly in the compact preview, the full-size
 * document, and the PDF.
 */
export function SignaturePlacementField({
	imageUrl,
	alt,
	placement,
	editable,
	busy,
	onCommit,
	className = "",
}: {
	imageUrl: string;
	alt: string;
	placement: SignaturePlacement;
	editable: boolean;
	busy?: boolean;
	/** Fires once per gesture, on release. */
	onCommit: (placement: Partial<SignaturePlacement>) => void;
	className?: string;
}) {
	// Local copy so the overlay tracks the cursor; the server value lands on
	// release and this re-syncs to it.
	const [draft, setDraft] = useState(placement);
	useEffect(() => setDraft(placement), [placement]);

	const dragRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		originX: number;
		originY: number;
	} | null>(null);

	const height = SIGNATURE_BASE_HEIGHT_PX * draft.scale;

	const startDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
		if (!editable) return;
		e.preventDefault();
		dragRef.current = {
			pointerId: e.pointerId,
			startX: e.clientX,
			startY: e.clientY,
			originX: draft.offsetX,
			originY: draft.offsetY,
		};
		e.currentTarget.setPointerCapture(e.pointerId);
	};

	const moveDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== e.pointerId) return;
		setDraft((prev) => ({
			...prev,
			offsetX: clampOffset(
				drag.originX + (e.clientX - drag.startX) / SIGNATURE_BASE_HEIGHT_PX,
			),
			// Screen y grows downward; our offset grows upward.
			offsetY: clampOffset(
				drag.originY - (e.clientY - drag.startY) / SIGNATURE_BASE_HEIGHT_PX,
			),
		}));
	};

	const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== e.pointerId) return;
		dragRef.current = null;
		if (
			draft.offsetX !== placement.offsetX ||
			draft.offsetY !== placement.offsetY
		) {
			onCommit({ offsetX: draft.offsetX, offsetY: draft.offsetY });
		}
	};

	// Arrow keys nudge by a tenth of the base height — the fine adjustment a
	// pointer can't do precisely.
	const nudge = (e: React.KeyboardEvent<HTMLButtonElement>) => {
		if (!editable) return;
		const step = e.shiftKey ? 0.02 : 0.1;
		const delta: Partial<SignaturePlacement> = {};
		if (e.key === "ArrowLeft")
			delta.offsetX = clampOffset(draft.offsetX - step);
		else if (e.key === "ArrowRight")
			delta.offsetX = clampOffset(draft.offsetX + step);
		else if (e.key === "ArrowUp")
			delta.offsetY = clampOffset(draft.offsetY + step);
		else if (e.key === "ArrowDown")
			delta.offsetY = clampOffset(draft.offsetY - step);
		else return;
		e.preventDefault();
		setDraft((prev) => ({ ...prev, ...delta }));
		onCommit(delta);
	};

	const isPlaced =
		draft.offsetX !== 0 || draft.offsetY !== 0 || draft.scale !== 1;

	return (
		<div className={className}>
			<div
				className="relative overflow-visible border-b border-border/60"
				style={{ height: SIGNATURE_FIELD_HEIGHT_PX }}
			>
				{/* A button rather than a bare div: it is focusable and labelled for
				    free, so arrow-key nudging works without a custom tabindex. */}
				<button
					type="button"
					disabled={!editable}
					aria-label="Drag to position the signature; arrow keys nudge it"
					onPointerDown={startDrag}
					onPointerMove={moveDrag}
					onPointerUp={endDrag}
					onPointerCancel={endDrag}
					onKeyDown={nudge}
					className={`absolute bottom-0 left-0 z-10 touch-none rounded-sm p-0 outline-none ${
						editable
							? "cursor-grab ring-primary/40 hover:ring-2 focus-visible:ring-2 active:cursor-grabbing"
							: "cursor-default"
					} ${busy ? "opacity-60" : ""}`}
					style={{
						height,
						transform: `translate(${draft.offsetX * SIGNATURE_BASE_HEIGHT_PX}px, ${
							-draft.offsetY * SIGNATURE_BASE_HEIGHT_PX
						}px)`,
					}}
				>
					<img
						src={imageUrl}
						alt={alt}
						draggable={false}
						className="pointer-events-none h-full max-w-none select-none object-contain"
					/>
				</button>
			</div>

			{editable && (
				<div className="mt-2 space-y-1.5">
					<SignatureSizeControl
						scale={placement.scale}
						disabled={busy}
						onPreview={(scale) => setDraft((prev) => ({ ...prev, scale }))}
						onCommit={(scale) => onCommit({ scale })}
					/>
					<div className="flex items-center justify-between gap-2">
						<p className="text-[11px] text-muted-foreground">
							Drag the signature onto the line — arrow keys nudge it.
						</p>
						{isPlaced && (
							<button
								type="button"
								onClick={() => {
									setDraft(DEFAULT_SIGNATURE_PLACEMENT);
									onCommit(DEFAULT_SIGNATURE_PLACEMENT);
								}}
								disabled={busy}
								className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
							>
								Reset
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

/**
 * Slider for how large a signature image renders in the agreement. The same
 * multiplier drives the editor, the live preview, and the PDF, so what the
 * signer sets here is what the client sees.
 */
export function SignatureSizeControl({
	scale,
	disabled,
	onPreview,
	onCommit,
	className = "",
}: {
	scale: number;
	disabled?: boolean;
	/** Fires on every drag step so the signature resizes under the cursor. */
	onPreview: (scale: number) => void;
	/** Fires on release — the only point anything is persisted. */
	onCommit: (scale: number) => void;
	className?: string;
}) {
	const [draft, setDraft] = useState(scale);
	// Follow the server once a save lands (or another device changes it).
	useEffect(() => setDraft(scale), [scale]);

	return (
		<div className={`flex items-center gap-2 ${className}`}>
			<span className="text-[11px] font-medium text-muted-foreground">
				Size
			</span>
			<input
				type="range"
				min={SIGNATURE_MIN_SCALE}
				max={SIGNATURE_MAX_SCALE}
				step={0.1}
				value={draft}
				disabled={disabled}
				aria-label="Signature size"
				onChange={(e) => {
					const next = Number(e.target.value);
					setDraft(next);
					onPreview(next);
				}}
				onPointerUp={() => onCommit(draft)}
				onKeyUp={() => onCommit(draft)}
				className="h-1 flex-1 cursor-pointer accent-primary disabled:opacity-50"
			/>
			<span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
				{Math.round(draft * 100)}%
			</span>
		</div>
	);
}
