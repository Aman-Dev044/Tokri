import 'reflect-metadata';
import { ForbiddenException, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    // Required so the Razorpay webhook can verify its HMAC against the
    // RAW body. A parsed body will not match the signature.
    rawBody: true,
    logger: ['error', 'warn', 'log'],
  });

  const config = app.get(ConfigService);
  const env = config.getOrThrow<string>('env');
  const port = config.getOrThrow<number>('port');
  const prefix = config.getOrThrow<string>('apiPrefix');

  // ── CORS — allowlist comes from CORS_ORIGINS in .env ──────────────
  // Never '*'. The Joi schema rejects a wildcard outright, because a
  // wildcard origin combined with credentials is a cross-origin
  // credential leak.
  const origins = config.getOrThrow<string[]>('cors.origins');
  app.enableCors({
    origin: (requestOrigin, callback) => {
      // Same-origin and server-to-server calls send no Origin header.
      if (!requestOrigin) return callback(null, true);
      if (origins.includes(requestOrigin)) return callback(null, true);
      logger.warn(`CORS rejected origin: ${requestOrigin}`);
      // A ForbiddenException, not a bare Error: a bare Error reaches the
      // exception filter as an unknown failure and is rendered as 500,
      // which reports a deliberate policy decision as a server fault.
      return callback(new ForbiddenException('Origin not allowed'), false);
    },
    credentials: config.getOrThrow<boolean>('cors.credentials'),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-Requested-With',
    ],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86_400,
  });

  // ── Transport hardening ───────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: env === 'production' ? undefined : false,
      crossOriginEmbedderPolicy: false,
      hsts: env === 'production' ? { maxAge: 63_072_000, includeSubDomains: true, preload: true } : false,
    }),
  );
  app.use(compression());
  app.use(cookieParser());

  // Strips `$` and `.` keys from request payloads — blocks Mongo
  // operator injection such as { "password": { "$ne": null } }.
  app.use(mongoSanitize({ replaceWith: '_' }));

  app.setGlobalPrefix(prefix);

  // ── Input validation ──────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // An unknown property is REJECTED, not silently dropped. This stops
      // mass-assignment attempts such as posting { role: 'admin' }.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── API docs — never public in production ─────────────────────────
  if (env !== 'production') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Mandi API')
        .setDescription('Multi-vendor grocery delivery ecosystem')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup(`${prefix}/docs`, app, doc);
    logger.log(`Swagger: http://localhost:${port}/${prefix}/docs`);
  }

  app.enableShutdownHooks();

  await app.listen(port);
  logger.log(`Mandi API [${env}] listening on http://localhost:${port}/${prefix}`);
  logger.log(`CORS allowlist: ${origins.join(', ')}`);
}

bootstrap();
