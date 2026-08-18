import { Eraser, PenLine, Type } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Capture a set of initials, two ways: typed in a signature face, or drawn.
 *
 * Both resolve to a PNG, because the page stamps an image either way. The typed
 * characters travel alongside it — the typed text is the legally operative act
 * and the script rendering is only how it is drawn, the same split the
 * end-of-document signature already makes.
 *
 * Uploading an image is deliberately NOT offered, matching the rule
 * `SignaturePad` documents: an uploaded file is the one input that cannot be
 * attributed to the person at the keyboard. Adobe Sign's typed and drawn modes
 * are the two that survive that test.
 *
 * Drawing accepts pen and touch as well as mouse, so the same control works on
 * a phone — including on the account-free signing page a client reaches from
 * their email.
 */

export type InitialsMethod = "typed" | "drawn";

export interface CapturedInitials {
	method: InitialsMethod;
	/** Typed characters, or null for a drawn mark. */
	text: string | null;
	/** `data:image/png;base64,…` — what gets stamped on each page. */
	png: string;
}

const FONTS = [
	{ id: "caveat", label: "Caveat", className: "font-signature-caveat" },
	{ id: "script", label: "Script", className: "font-signature-script" },
] as const;

/** Rendered at 3× so the stamp stays crisp when the page is zoomed or printed. */
const RENDER_SCALE = 3;
const STAMP_WIDTH = 120;
const STAMP_HEIGHT = 56;

export function InitialsPad({
	defaultText,
	onCapture,
	onClear,
	disabled,
}: {
	/** Seeded from the signer's name, e.g. "Juan Carlos Gan" → "JCG". */
	defaultText?: string;
	onCapture: (initials: CapturedInitials) => void;
	onClear?: () => void;
	disabled?: boolean;
}) {
	const [mode, setMode] = useState<InitialsMethod>("typed");
	const [text, setText] = useState(defaultText ?? "");
	const [fontId, setFontId] = useState<(typeof FONTS)[number]["id"]>("caveat");
	const [hasDrawing, setHasDrawing] = useState(false);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const drawing = useRef(false);
	const typedRef = useRef<HTMLSpanElement>(null);
	const inputId = useId();

	const font = FONTS.find((f) => f.id === fontId) ?? FONTS[0];

	useEffect(() => {
		const ctx = canvasRef.current?.getContext("2d");
		if (!ctx) return;
		ctx.lineWidth = 2.5;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.strokeStyle = "#111827";
	}, []);

	/** Canvas coordinates for a mouse, pen or touch point. */
	const pointFrom = (event: React.PointerEvent<HTMLCanvasElement>) => {
		const canvas = canvasRef.current;
		if (!canvas) return { x: 0, y: 0 };
		const rect = canvas.getBoundingClientRect();
		return {
			x: ((event.clientX - rect.left) / rect.width) * canvas.width,
			y: ((event.clientY - rect.top) / rect.height) * canvas.height,
		};
	};

	const startStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
		if (disabled) return;
		// Capture the pointer so a stroke that leaves the canvas still ends here,
		// and so a touch drag scrolls the page instead of only when it should.
		event.currentTarget.setPointerCapture(event.pointerId);
		event.preventDefault();
		const ctx = canvasRef.current?.getContext("2d");
		if (!ctx) return;
		const { x, y } = pointFrom(event);
		ctx.beginPath();
		ctx.moveTo(x, y);
		drawing.current = true;
	};

	const extendStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
		if (!drawing.current) return;
		event.preventDefault();
		const ctx = canvasRef.current?.getContext("2d");
		if (!ctx) return;
		const { x, y } = pointFrom(event);
		ctx.lineTo(x, y);
		ctx.stroke();
		setHasDrawing(true);
	};

	const endStroke = () => {
		drawing.current = false;
	};

	const clearCanvas = () => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		setHasDrawing(false);
		onClear?.();
	};

	/** Paints the typed characters onto an offscreen canvas in the chosen face. */
	const renderTyped = (): string | null => {
		const value = text.trim();
		if (!value) return null;
		const canvas = document.createElement("canvas");
		canvas.width = STAMP_WIDTH * RENDER_SCALE;
		canvas.height = STAMP_HEIGHT * RENDER_SCALE;
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		const family =
			fontId === "caveat"
				? '"Caveat", "Segoe Script", cursive'
				: '"Dancing Script", "Segoe Script", cursive';
		ctx.fillStyle = "#111827";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.font = `600 ${34 * RENDER_SCALE}px ${family}`;
		ctx.fillText(
			value,
			canvas.width / 2,
			canvas.height / 2,
			canvas.width * 0.9,
		);
		return canvas.toDataURL("image/png");
	};

	const capture = () => {
		if (disabled) return;
		if (mode === "typed") {
			const png = renderTyped();
			if (!png) return;
			onCapture({ method: "typed", text: text.trim(), png });
			return;
		}
		const canvas = canvasRef.current;
		if (!canvas || !hasDrawing) return;
		onCapture({
			method: "drawn",
			text: null,
			png: canvas.toDataURL("image/png"),
		});
	};

	const ready = mode === "typed" ? text.trim().length > 0 : hasDrawing;

	return (
		<div className="rounded-xl border border-border bg-card p-3">
			<div className="flex items-center gap-1.5">
				<ModeButton
					active={mode === "typed"}
					onClick={() => setMode("typed")}
					icon={Type}
					label="Type"
				/>
				<ModeButton
					active={mode === "drawn"}
					onClick={() => setMode("drawn")}
					icon={PenLine}
					label="Draw"
				/>
				{mode === "drawn" && hasDrawing && (
					<button
						type="button"
						onClick={clearCanvas}
						className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
					>
						<Eraser className="h-3 w-3" /> Clear
					</button>
				)}
			</div>

			{mode === "typed" ? (
				<div className="mt-3 space-y-2">
					<label
						htmlFor={inputId}
						className="block text-[11px] font-medium text-muted-foreground"
					>
						Your initials
					</label>
					<div className="flex items-center gap-2">
						<input
							id={inputId}
							value={text}
							disabled={disabled}
							maxLength={8}
							onChange={(event) =>
								setText(event.target.value.toUpperCase().slice(0, 8))
							}
							placeholder="JCG"
							className="h-9 w-24 rounded-lg border border-input bg-background px-2 text-center text-sm font-semibold uppercase tracking-widest outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
						/>
						<div className="flex gap-1">
							{FONTS.map((option) => (
								<button
									key={option.id}
									type="button"
									onClick={() => setFontId(option.id)}
									className={`rounded-md border px-2 py-1 text-lg leading-none ${option.className} ${
										fontId === option.id
											? "border-primary bg-primary/5 text-foreground"
											: "border-border text-muted-foreground hover:bg-muted"
									}`}
									aria-label={`${option.label} signature style`}
									aria-pressed={fontId === option.id}
								>
									{text.trim() || "Ab"}
								</button>
							))}
						</div>
					</div>
					{/* What will be stamped, at the size it will appear. */}
					<div className="flex h-14 items-center justify-center rounded-lg border border-dashed border-border bg-white">
						<span
							ref={typedRef}
							className={`text-3xl leading-none text-[#111827] ${font.className}`}
						>
							{text.trim() || (
								<span className="text-base text-muted-foreground">Preview</span>
							)}
						</span>
					</div>
				</div>
			) : (
				<div className="mt-3">
					<canvas
						ref={canvasRef}
						width={STAMP_WIDTH * RENDER_SCALE}
						height={STAMP_HEIGHT * RENDER_SCALE}
						onPointerDown={startStroke}
						onPointerMove={extendStroke}
						onPointerUp={endStroke}
						onPointerLeave={endStroke}
						onPointerCancel={endStroke}
						// touch-none stops the browser turning a stroke into a scroll,
						// which is what makes drawing usable on a phone at all.
						className="h-24 w-full touch-none rounded-lg border border-dashed border-border bg-white"
						aria-label="Draw your initials"
					/>
				</div>
			)}

			<button
				type="button"
				onClick={capture}
				disabled={disabled || !ready}
				className="app-cta mt-3 w-full rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
			>
				Apply to every page
			</button>
		</div>
	);
}

function ModeButton({
	active,
	onClick,
	icon: Icon,
	label,
}: {
	active: boolean;
	onClick: () => void;
	icon: typeof Type;
	label: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
				active
					? "bg-primary/10 text-primary"
					: "text-muted-foreground hover:bg-muted hover:text-foreground"
			}`}
		>
			<Icon className="h-3.5 w-3.5" />
			{label}
		</button>
	);
}

/** "Juan Carlos Gan" → "JCG". The seed a signer usually just accepts. */
export function initialsFromName(name: string | null | undefined): string {
	return (name ?? "")
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 4)
		.map((part) => part[0]?.toUpperCase() ?? "")
		.join("");
}
