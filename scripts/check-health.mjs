import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';

let app;
try {
  app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();
  for (const path of ['/health/live', '/health']) {
    const response = await fetch(`${baseUrl}${path}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json();
    console.log(`${path}: HTTP ${response.status}`, result);
    if (!response.ok) process.exitCode = 1;
  }
} catch {
  console.error(
    'Health check failed. Run pnpm run db:check for connection diagnostics.',
  );
  process.exitCode = 1;
} finally {
  await app?.close();
}
