import 'reflect-metadata';
import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, RequestMethod } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';
import express from 'express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { CachePolicyInterceptor } from './common/interceptors/cache-policy.interceptor';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { RequestTimeoutInterceptor } from './common/interceptors/request-timeout.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

const expressServer = express();
let cachedApp: express.Express | null = null;

async function createApp(): Promise<express.Express> {
  if (cachedApp) return cachedApp;

  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressServer),
    { logger: ['error', 'warn'] },
  );

  const config = app.get(ConfigService);

  app.use(helmet());
  app.use(compression());

  const rawOrigins = config.get<string>(
    'CORS_ORIGINS',
    'http://localhost:3000,http://localhost:5173',
  );
  const allowedOrigins = rawOrigins
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''));

  app.enableCors({
    origin: (origin, callback) => {
      // allow server-to-server / curl (no origin header)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  });

  app.setGlobalPrefix('api', {
    exclude: [{ path: '/', method: RequestMethod.GET }],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  const requestTimeoutMs = config.get<number>('REQUEST_TIMEOUT_MS', 25000);
  const slowRequestThresholdMs = config.get<number>(
    'SLOW_REQUEST_THRESHOLD_MS',
    1500,
  );
  const reflector = app.get(Reflector);

  app.useGlobalInterceptors(
    new RequestTimeoutInterceptor(requestTimeoutMs),
    new RequestLoggingInterceptor(slowRequestThresholdMs),
    new CachePolicyInterceptor(reflector),
    new ResponseInterceptor(reflector),
  );

  await app.init();

  cachedApp = expressServer;
  return expressServer;
}

export default async (
  req: express.Request,
  res: express.Response,
): Promise<void> => {
  const app = await createApp();
  app(req, res);
};
