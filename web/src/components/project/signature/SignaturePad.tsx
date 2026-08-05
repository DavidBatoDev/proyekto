import { PenLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/useToast";
import {
	DEFAULT_SIGNATURE_PLACEMENT,
	type SignaturePlacement,
} from "@/services/contract.service";
import { uploadService } from "@/services/upload.service";

/**
 * Name input + signature capture. Two ways to sign, both of them made here and
 * now: type your full name, and optionally draw it on the canvas.
 *
 * Uploading a signature image is deliberately NOT offered. An uploaded file is
 * the one input we cannot attribute to the person at the keyboard — it could be
 * any image lifted from anywhere — which is exactly the property a signature is
 * supposed to have. DocuSign's model is the same: the typed name is the legally
 * operative act and the drawn mark is its rendering.
 *
 * A drawing is flattened to a PNG. Signed in, it is uploaded to R2 and only
 * the URL rides along with the sign request. On the PUBLIC signing page there
 * is no session to upload with, so `deliver: "data-url"` hands the caller the
 * base64 image instead and the server stores it.
 */
export function SignaturePad({
	name,
	onNameChange,
	onSign,
	isPending,
	deliver = "upload",
	compact = false,
}: {
	name: string;
	onNameChange: (v: string) => void;
	/**
	 * Receives an R2 URL when `deliver` is "upload", a `data:image/png;base64,…`
	 * string when it is "data-url", or null for a typed-name-only signature.
	 */
	onSign: (signature?: string | null, placement?: SignaturePlacement) => void;
	isPending: boolean;
	deliver?: "upload" | "data-url";
	compact?: boolean;
}) {
	const toast = useToast();
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const drawing = useRef(false);
	const [hasDrawing, setHasDrawing] = useState(false);
	const [uploading, setUploading] = useState(false);

	// Ink style is set once; the stroke is dark so it reads on the white document.
	useEffect(() => {
		const ctx = canvasRef.current?.getContext("2d");
		if (!ctx) return;
		ctx.lineWidth = 2.5;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.strokeStyle = "#1e293b";
	}, []);

	const pointFor = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const canvas = canvasRef.current;
		if (!canvas) return { x: 0, y: 0 };
		const rect = canvas.getBoundingClientRect();
		return {
			x: (e.clientX - rect.left) * (canvas.width / rect.width),
			y: (e.clientY - rect.top) * (canvas.height / rect.height),
		};
	};

	const startStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const ctx = canvasRef.current?.getContext("2d");
		if (!ctx) return;
		drawing.current = true;
		const { x, y } = pointFor(e);
		ctx.beginPath();
		ctx.moveTo(x, y);
		e.currentTarget.setPointerCapture(e.pointerId);
	};

	const moveStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
		if (!drawing.current) return;
		const ctx = canvasRef.current?.getContext("2d");
		if (!ctx) return;
		const { x, y } = pointFor(e);
		ctx.lineTo(x, y);
		ctx.stroke();
		if (!hasDrawing) setHasDrawing(true);
	};

	const endStroke = () => {
		drawing.current = false;
	};

	const clear = () => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
		setHasDrawing(false);
	};

	const handleSign = async () => {
		const canvas = canvasRef.current;
		// Typed name only — the legally operative part is present, so sign with
		// no image rather than blocking on a drawing.
		if (!hasDrawing || !canvas) {
			onSign(null);
			return;
		}
		// No session on the public signing page — hand the bytes to the caller
		// and let the server put them in the bucket.
		if (deliver === "data-url") {
			onSign(canvas.toDataURL("image/png"), DEFAULT_SIGNATURE_PLACEMENT);
			return;
		}

		setUploading(true);
		try {
			const blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob(resolve, "image/png"),
			);
			if (!blob) {
				onSign(null);
				return;
			}
			const file = new File([blob], "signature.png", { type: "image/png" });
			const url = await uploadService.uploadContractSignature(file);
			onSign(url, DEFAULT_SIGNATURE_PLACEMENT);
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Signature upload failed",
			);
		} finally {
			setUploading(false);
		}
	};

	return (
		<div className={compact ? "mt-2 space-y-1.5" : "mt-3 space-y-2"}>
			<input
				type="text"
				placeholder="Type your full name"
				value={name}
				onChange={(e) => onNameChange(e.target.value)}
				className={`w-full border border-input bg-card text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 ${compact ? "rounded-md px-2.5 py-1.5 text-xs" : "rounded-lg px-3 py-2 text-sm"}`}
			/>

			<div className="relative rounded-lg border border-border bg-card">
				<canvas
					ref={canvasRef}
					width={600}
					height={160}
					onPointerDown={startStroke}
					onPointerMove={moveStroke}
					onPointerUp={endStroke}
					onPointerLeave={endStroke}
					className={`${compact ? "h-20 rounded-md" : "h-28 rounded-lg"} w-full touch-none`}
				/>
				{!hasDrawing && (
					<span
						className={`pointer-events-none absolute inset-0 flex items-center justify-center text-muted-foreground ${compact ? "text-[10px]" : "text-xs"}`}
					>
						Draw your signature here (optional)
					</span>
				)}
				{hasDrawing && (
					<button
						type="button"
						onClick={clear}
						className={`absolute right-1.5 top-1.5 rounded-md border border-border bg-card font-medium text-muted-foreground transition hover:text-foreground ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]"}`}
					>
						Clear
					</button>
				)}
			</div>

			<div>
				<button
					type="button"
					onClick={handleSign}
					disabled={!name.trim() || isPending || uploading}
					className={`inline-flex items-center gap-1.5 bg-primary font-semibold text-primary-foreground disabled:opacity-50 ${compact ? "rounded-md px-2.5 py-1.5 text-[11px]" : "rounded-lg px-3 py-2 text-xs"}`}
				>
					<PenLine className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
					{/* `isPending` matters as much as `uploading`: a typed-only signature
					    never uploads, so keying the label on `uploading` alone left the
					    button reading "Sign" while disabled mid-request. */}
					{isPending || uploading ? "Signing…" : "Sign"}
				</button>
			</div>
		</div>
	);
}
