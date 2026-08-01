import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import type { NodeSDK } from '@opentelemetry/sdk-node';

let sdk: NodeSDK | null = null;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function clampSampleRatio(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

export function initTracing(): void {
  if (sdk) return;

  const isProduction = process.env.NODE_ENV === 'production';
  const enabled = parseBoolean(process.env.ENABLE_CLOUD_TRACE, isProduction);
  if (!enabled) return;

  // Keep OTel diagnostics off by default to avoid noisy logs in production.
  if (parseBoolean(process.env.OTEL_DEBUG_LOGS, false)) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  const serviceName = process.env.OTEL_SERVICE_NAME || 'proyekto-backend';
  process.env.OTEL_SERVICE_NAME = serviceName;
  process.env.OTEL_TRACES_EXPORTER = process.env.OTEL_TRACES_EXPORTER || 'none';
  process.env.OTEL_METRICS_EXPORTER =
    process.env.OTEL_METRICS_EXPORTER || 'none';
  process.env.OTEL_LOGS_EXPORTER = process.env.OTEL_LOGS_EXPORTER || 'none';

  const sampleRatio = clampSampleRatio(
    process.env.CLOUD_TRACE_SAMPLE_RATIO,
    0.1,
  );

  // Deferred require: @opentelemetry/auto-instrumentations-node alone pulls
  // in 34 @opentelemetry/instrumentation-* + 5 resource-detector-* transitive
  // packages. A static top-level import would require() this whole graph on
  // every process boot even when the `enabled` gate above means the SDK
  // never starts (e.g. local dev) — that cost was being paid for nothing.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { getNodeAutoInstrumentations } =
    require('@opentelemetry/auto-instrumentations-node') as typeof import('@opentelemetry/auto-instrumentations-node');
  const { TraceExporter } =
    require('@google-cloud/opentelemetry-cloud-trace-exporter') as typeof import('@google-cloud/opentelemetry-cloud-trace-exporter');
  const { NodeSDK: NodeSDKCtor } =
    require('@opentelemetry/sdk-node') as typeof import('@opentelemetry/sdk-node');
  const { ParentBasedSampler, TraceIdRatioBasedSampler } =
    require('@opentelemetry/sdk-trace-base') as typeof import('@opentelemetry/sdk-trace-base');
  /* eslint-enable @typescript-eslint/no-require-imports */

  sdk = new NodeSDKCtor({
    traceExporter: new TraceExporter(),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(sampleRatio),
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();

  const shutdown = () => {
    if (!sdk) return;
    const activeSdk = sdk;
    sdk = null;

    void activeSdk.shutdown().catch((error: unknown) => {
      console.error('OpenTelemetry shutdown failed', error);
    });
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
