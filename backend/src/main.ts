import { NestFactory } from '@nestjs/core';
import { ValidationPipe, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Security & performance middleware
  app.use(helmet());
  app.use(compression());

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

  // Global prefix
  app.setGlobalPrefix('api', {
    exclude: [{ path: '/', method: RequestMethod.GET }],
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

  // Global response interceptor (wraps all successful responses in { data: ... })
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Let Cloud Run's SIGTERM drain in-flight requests via Nest's shutdown hooks.
  app.enableShutdownHooks();

  const port = config.get<number>('PORT', 3001);
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Backend running on http://localhost:${port}/api`);
}
bootstrap();
