import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface PurgeAttemptResult {
  ok: boolean;
  statusCode?: number;
  error?: string;
}

function readBoolean(
  configService: ConfigService,
  key: string,
  fallback: boolean,
): boolean {
  const raw = configService.get<string>(key);
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

function readPositiveInteger(
  configService: ConfigService,
  key: string,
  fallback: number,
): number {
  const raw = configService.get<string>(key);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

@Injectable()
export class CloudflareCachePurgeService {
  private readonly logger = new Logger(CloudflareCachePurgeService.name);

  constructor(private readonly configService: ConfigService) {}

  isEnabled(): boolean {
    return readBoolean(this.configService, 'CLOUDFLARE_PURGE_ENABLED', false);
  }

  getPurgeTimeoutMs(): number {
    return readPositiveInteger(
      this.configService,
      'CLOUDFLARE_PURGE_TIMEOUT_MS',
      2500,
    );
  }

  getApiBaseUrl(): string {
    const configured = this.configService.get<string>('PUBLIC_API_URL')?.trim();
    const raw =
      configured && configured.length > 0
        ? configured
        : 'https://api.proyekto.tech';
    return raw.replace(/\/+$/, '');
  }

  buildPublicUrl(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.getApiBaseUrl()}${normalizedPath}`;
  }

  async purgePaths(paths: string[]): Promise<void> {
    const urls = paths
      .map((path) => this.buildPublicUrl(path))
      .filter((url) => url.length > 0);
    await this.purgeUrls(urls);
  }

  async purgeUrls(urls: string[]): Promise<void> {
    const uniqueUrls = [...new Set(urls.filter((url) => url.length > 0))];
    if (uniqueUrls.length === 0) return;

    if (!this.isEnabled()) {
      this.logger.log(
        `edge_purge status=disabled url_count=${uniqueUrls.length}`,
      );
      return;
    }

    const zoneId = this.configService.get<string>('CLOUDFLARE_ZONE_ID');
    const apiToken = this.configService.get<string>('CLOUDFLARE_PURGE_API_TOKEN');
    if (!zoneId || !apiToken) {
      this.logger.warn(
        `edge_purge status=misconfigured has_zone_id=${Boolean(zoneId)} has_token=${Boolean(apiToken)} url_count=${uniqueUrls.length}`,
      );
      return;
    }

    const start = Date.now();
    const firstAttempt = await this.attemptPurge(uniqueUrls, zoneId, apiToken);
    if (firstAttempt.ok) {
      this.logger.log(
        `edge_purge status=success attempts=1 url_count=${uniqueUrls.length} duration_ms=${Date.now() - start}`,
      );
      return;
    }

    const secondAttempt = await this.attemptPurge(uniqueUrls, zoneId, apiToken);
    if (secondAttempt.ok) {
      this.logger.log(
        `edge_purge status=success attempts=2 url_count=${uniqueUrls.length} duration_ms=${Date.now() - start}`,
      );
      return;
    }

    this.logger.warn(
      `edge_purge status=failed attempts=2 url_count=${uniqueUrls.length} duration_ms=${
        Date.now() - start
      } first_status=${firstAttempt.statusCode ?? 0} second_status=${
        secondAttempt.statusCode ?? 0
      } first_error=${firstAttempt.error ?? 'none'} second_error=${
        secondAttempt.error ?? 'none'
      }`,
    );
  }

  private async attemptPurge(
    urls: string[],
    zoneId: string,
    apiToken: string,
  ): Promise<PurgeAttemptResult> {
    const timeoutMs = this.getPurgeTimeoutMs();
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ files: urls }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const responseBody = await response.text();
        return {
          ok: false,
          statusCode: response.status,
          error: responseBody.slice(0, 300),
        };
      }

      const responseJson = (await response.json()) as {
        success?: boolean;
      };
      return {
        ok: responseJson.success === true,
        statusCode: response.status,
        error:
          responseJson.success === true ? undefined : 'cloudflare_success=false',
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
