// backend/src/modules/execution/time/time-request.ts
import type { Request } from 'express';

/** The two WebView origins of the Capacitor shells (web/capacitor.config.ts, androidScheme 'https'). */
const NATIVE_ORIGINS: ReadonlySet<string> = new Set([
  'capacitor://localhost',
  'https://localhost',
]);

/** Capacitor shells send Origin capacitor://localhost (iOS) or https://localhost (Android). Exact match on the
 *  whole Origin (no port): https://localhost:3000 is a dev web origin and must read as web. */
export function isNativeOrigin(req: Pick<Request, 'headers'>): boolean {
  const raw: unknown = req.headers?.origin;
  const origin = Array.isArray(raw) ? (raw[0] as unknown) : raw;
  if (typeof origin !== 'string') return false;
  return NATIVE_ORIGINS.has(origin.trim());
}
