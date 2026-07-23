import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';
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

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  });

  // Global prefix. `/mcp` is served off the /api tree so MCP hosts and (later)
  // OAuth discovery point at a clean root path; the PAT management routes stay
  // under /api/mcp/tokens.
  app.setGlobalPrefix('api', {
    exclude: [
      { path: '/', method: RequestMethod.GET },
      { path: 'mcp', method: RequestMethod.ALL },
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
