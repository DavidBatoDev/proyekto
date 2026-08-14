export type ToolbarItemType = "epic" | "feature" | "task";

export const TOOLBAR_DRAG_MIME = "application/x-roadmap-toolbar-item";

const isToolbarItemType = (value: unknown): value is ToolbarItemType =>
	value === "epic" || value === "feature" || value === "task";

/**
 * Works out which "Drag To Add" chip is being dragged.
 *
 * The fallback chain is not defensive padding — it is required. Browsers
 * deliberately hide custom drag data during `dragover` (only the *types* are
 * readable, not the values), so the dragover handler cannot read the MIME
 * payload it set on dragstart. `draggingType` is the component's own record of
 * what the user picked up, and it is what actually resolves the common case.
 *
 * Order: custom MIME → text/plain → the in-flight type we remembered.
 *
 * The original had two further branches (`types.includes(MIME) && draggingType`
 * and the same for `text/plain`). Both were unreachable — the bare
 * `if (draggingType)` above already returns in every case they could match — so
 * they are dropped rather than carried over as decoration.
 */
export function readToolbarItemFromTransfer(
	event: { dataTransfer: DataTransfer | null },
	draggingType: ToolbarItemType | null,
): ToolbarItemType | null {
	const rawCustom = event.dataTransfer?.getData(TOOLBAR_DRAG_MIME);
	if (isToolbarItemType(rawCustom)) return rawCustom;

	const rawText = event.dataTransfer?.getData("text/plain");
	if (isToolbarItemType(rawText)) return rawText;

	return draggingType;
}

/** Populates a dragstart transfer so both the custom MIME and text/plain carry the type. */
export function writeToolbarItemToTransfer(
	dataTransfer: DataTransfer,
	itemType: ToolbarItemType,
): void {
	dataTransfer.setData(TOOLBAR_DRAG_MIME, itemType);
	dataTransfer.setData("text/plain", itemType);
	dataTransfer.effectAllowed = "move";
}
