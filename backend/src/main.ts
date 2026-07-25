import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, RequestMethod } from '@nestjs/common';
import type { CorsOptionsDelegate } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';
import type { Request } from 'express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { CachePolicyInterceptor } from './common/interceptors/cache-policy.interceptor';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { RequestTimeoutInterceptor } from './common/interceptors/request-timeout.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Security & performance middleware
  app.use(helmet());
  // Compression is skipped for /mcp: the MCP Streamable-HTTP transport writes
  // its own (possibly streamed) JSON-RPC response, which must not be buffered
  // or transformed by the compression middleware.
  app.use(
    compression({
      filter: (req, res) => req.path !== '/mcp' && compression.filter(req, res),
    }),
  );

  // CORS
  const rawOrigins = config.get<string>(
    'CORS_ORIGINS',
    'http://localhost:3000,http://localhost:5173',
  );
  const allowedOrigins = rawOrigins
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''));

  // A per-request delegate rather than a static policy, because the OAuth
  // discovery / token / registration endpoints need a DIFFERENT policy from the
  // rest of the API: they are fetched cross-origin by arbitrary MCP clients and
  // carry no cookies, so they get `origin: '*'` — which is incompatible with
  // `credentials: true` and therefore cannot be expressed in one policy.
  const corsDelegate: CorsOptionsDelegate<Request> = (req, callback) => {
    const path = req.url ?? '';
    if (path.startsWith('/oauth') || path.startsWith('/.well-known')) {
      callback(null, {
        origin: '*',
        credentials: false,
        exposedHeaders: ['WWW-Authenticate'],
      });
      return;
    }

    const origin = req.headers.origin;
    // Reject by omitting the CORS headers, NOT by passing an Error: an Error
    // here escapes to Express's default handler and becomes a bare 500 with no
    // envelope, which is both wrong and confusing to debug.
    const allowed = !origin || allowedOrigins.includes(origin);
    callback(null, {
      origin: allowed ? (origin ?? true) : false,
      credentials: true,
      // MCP clients must be able to read the RFC 9728 challenge to discover the
      // authorization server, and the protocol version during handshake.
      exposedHeaders: ['WWW-Authenticate', 'MCP-Protocol-Version'],
    });
  };
  app.enableCors(corsDelegate);

  // Global prefix. `/mcp` and the OAuth surface are served off the /api tree
  // because MCP hosts and OAuth clients look for them at clean root paths.
  //
  // NOTE: the `mcp` entry is EXACT-match on purpose. Widening it to a wildcard
  // would silently move the PAT management routes from /api/mcp/tokens to
  // /mcp/tokens and break the web settings page.
  app.setGlobalPrefix('api', {
    exclude: [
      { path: '/', method: RequestMethod.GET },
      { path: 'mcp', method: RequestMethod.ALL },
      { path: '.well-known/*splat', method: RequestMethod.ALL },
      { path: 'oauth/*splat', method: RequestMethod.ALL },
    ],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  const requestTimeoutMs = config.get<number>('REQUEST_TIMEOUT_MS', 25000);
  const slowRequestThresholdMs = config.get<number>(
    'SLOW_REQUEST_THRESHOLD_MS',
    1500,
  );
  const reflector = app.get(Reflector);

  // Global interceptors:
  // - timeout protection so hanging work doesn't consume all concurrency slots
  // - request timings to surface hotspots under load
  // - success response wrapper
  app.useGlobalInterceptors(
    new RequestTimeoutInterceptor(requestTimeoutMs),
    new RequestLoggingInterceptor(slowRequestThresholdMs),
    new CachePolicyInterceptor(reflector),
    new ResponseInterceptor(reflector),
  );

  // Let Cloud Run's SIGTERM drain in-flight requests via Nest's shutdown hooks.
  app.enableShutdownHooks();

  const port = config.get<number>('PORT', 3001);
  await app.listen(port, '0.0.0.0');
  console.log(`Backend running on http://localhost:${port}/api`);
}
bootstrap();
