/**
 * Maps a freshly-uploaded image's CDN URL → the local blob URL the sender
 * already holds (and which is already decoded in the browser).
 *
 * Why: when you send an image, the optimistic bubble renders it from a blob
 * URL. On reconcile (and again on the realtime refetch) the message's
 * attachment URL becomes the CDN URL, so a naive `<img src>` would switch from
 * the blob to the CDN URL — the browser unloads the old image and re-fetches
 * the identical bytes over the network, flashing blank. By rendering the blob
 * for these just-sent images, the displayed `src` never changes, so there's no
 * reload and no flash. Received/historical images (not in this map) render from
 * the CDN URL directly.
 *
 * The sender owns the blob's lifetime and clears its entries (revoke + forget)
 * when its chat view unmounts.
 */
const cdnToBlob = new Map<string, string>();

export function rememberAttachmentBlob(cdnUrl: string, blobUrl: string): void {
  if (cdnUrl && blobUrl) cdnToBlob.set(cdnUrl, blobUrl);
}

export function resolveAttachmentSrc(url: string): string {
  return cdnToBlob.get(url) ?? url;
}

export function forgetAttachmentBlob(cdnUrl: string): void {
  cdnToBlob.delete(cdnUrl);
}
