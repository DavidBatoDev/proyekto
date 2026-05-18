import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { TraceExporter } from '@google-cloud/opentelemetry-cloud-trace-exporter';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';

let sdk: NodeSDK | null = null;

function parseBoolean(
  value: string | undefined,
  fallback: boolean,
): boolean {
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
  process.env.OTEL_METRICS_EXPORTER = process.env.OTEL_METRICS_EXPORTER || 'none';
  process.env.OTEL_LOGS_EXPORTER = process.env.OTEL_LOGS_EXPORTER || 'none';

  const sampleRatio = clampSampleRatio(process.env.CLOUD_TRACE_SAMPLE_RATIO, 0.1);

  sdk = new NodeSDK({
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
