import { json, urlencoded } from 'express';
import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
    bodyParser: false,
  });
  app.use(json({ limit: '30mb' }));
  app.use(urlencoded({ extended: true, limit: '30mb' }));
  app.enableShutdownHooks();
  const webOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:8081,http://localhost:19006')
    .split(',').map((origin) => origin.trim()).filter(Boolean);
  app.enableCors({ origin: webOrigins, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'] });
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
