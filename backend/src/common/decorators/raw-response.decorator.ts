import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route handler so the global ResponseInterceptor returns its result
 * verbatim instead of wrapping it in `{ data }`. Use for endpoints with an
 * external response contract (e.g. the Capgo OTA update-check endpoint, which
 * expects `{ version, url, checksum }` at the top level).
 */
export const RAW_RESPONSE_KEY = 'rawResponse';
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);
