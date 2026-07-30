/**
 * Signature geometry, shared by the contract editor, the live document preview,
 * and (by mirrored value) the backend PDF renderer.
 *
 * These numbers used to be declared independently in `contract.tsx` and
 * `ContractDocumentPreview.tsx`. They MUST agree: a signer positions the stamp
 * against the editor's field, and the document has to place it identically or
 * the signature drifts off the printed line.
 */

/** Base rendered height of a signature image at scale 1, in px. */
export const SIGNATURE_BASE_HEIGHT_PX = 56;
/** Height of the signature field. FIXED — the document never reflows. */
export const SIGNATURE_FIELD_HEIGHT_PX = 64;

/** The same two, for the compact (non-`large`) document preview. */
export const SIGNATURE_COMPACT_BASE_HEIGHT_PX = 44;
export const SIGNATURE_COMPACT_FIELD_HEIGHT_PX = 48;

/** Mirrors the DB check on contracts.signed_by_*_signature_scale (0.5–3). */
export const SIGNATURE_MIN_SCALE = 0.5;
export const SIGNATURE_MAX_SCALE = 3;
/** Mirrors the DB check on contracts.signed_by_*_signature_offset_x/_y (±3). */
export const SIGNATURE_MAX_OFFSET = 3;

/** Clamp an offset to what the column accepts, so a drag can never save out of range. */
export const clampSignatureOffset = (v: number) =>
	Math.min(SIGNATURE_MAX_OFFSET, Math.max(-SIGNATURE_MAX_OFFSET, v));
