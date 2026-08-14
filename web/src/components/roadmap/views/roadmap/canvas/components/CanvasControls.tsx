import { Maximize, Minus, Plus } from "lucide-react";

/**
 * Zoom / fit-view controls for the roadmap canvas.
 *
 * Replaces `<Controls />` from `@xyflow/react` so the chrome is owned by us and
 * survives the canvas-renderer swap: it takes plain callbacks and holds no
 * renderer context. Two other things it buys:
 *
 *  - **Stable test hooks.** The Playwright suite used to reach for React Flow's
 *    internal `.react-flow__controls-*` classes. The `data-testid`s here are the
 *    replacement; the legacy classes are kept alongside them for one release so
 *    the specs can migrate without a flag-day.
 *  - **Theme tokens.** React Flow's buttons needed `!important` overrides in
 *    `styles.css` to respect dark mode. These use tokens directly.
 *
 * Note: React Flow's fourth button — the interactivity lock — is deliberately not
 * reproduced. It toggled `nodesDraggable` in React Flow's internal store, which
 * this canvas immediately re-asserted from its controlled `nodesDraggable`
 * prop, so the button could not hold its state. There is also no selection or
 * connection model here for it to gate.
 */
export interface CanvasControlsProps {
	onZoomIn: () => void;
	onZoomOut: () => void;
	onFitView: () => void;
	/** Disables the zoom-in button once `maxZoom` is reached. */
	zoomInDisabled?: boolean;
	/** Disables the zoom-out button once `minZoom` is reached. */
	zoomOutDisabled?: boolean;
	className?: string;
}

const BUTTON_CLASS =
	"react-flow__controls-button flex h-7 w-7 items-center justify-center text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40";

export function CanvasControls({
	onZoomIn,
	onZoomOut,
	onFitView,
	zoomInDisabled = false,
	zoomOutDisabled = false,
	className,
}: CanvasControlsProps) {
	return (
		<div
			// `react-flow__controls` is retained only so the existing e2e selectors
			// and the styles.css overrides keep matching during the migration.
			className={`react-flow__controls absolute top-3 right-3 z-10 flex flex-col overflow-hidden rounded-md border border-border bg-card shadow-sm ${
				className ?? ""
			}`}
			data-testid="roadmap-canvas-controls"
		>
			<button
				type="button"
				onClick={onZoomIn}
				disabled={zoomInDisabled}
				className={`${BUTTON_CLASS} react-flow__controls-zoomin border-b border-border`}
				data-testid="roadmap-canvas-zoom-in"
				title="Zoom in"
				aria-label="Zoom in"
			>
				<Plus className="h-3.5 w-3.5" />
			</button>
			<button
				type="button"
				onClick={onZoomOut}
				disabled={zoomOutDisabled}
				className={`${BUTTON_CLASS} react-flow__controls-zoomout border-b border-border`}
				data-testid="roadmap-canvas-zoom-out"
				title="Zoom out"
				aria-label="Zoom out"
			>
				<Minus className="h-3.5 w-3.5" />
			</button>
			<button
				type="button"
				onClick={onFitView}
				className={`${BUTTON_CLASS} react-flow__controls-fitview`}
				data-testid="roadmap-canvas-fit-view"
				title="Fit view"
				aria-label="Fit view"
			>
				<Maximize className="h-3.5 w-3.5" />
			</button>
		</div>
	);
}
