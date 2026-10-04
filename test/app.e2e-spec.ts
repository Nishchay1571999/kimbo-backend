import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { vi } from 'vitest';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  const query = vi.fn();

  beforeEach(async () => {
    query.mockReset().mockResolvedValue([{ ok: 1 }]);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ client: { $queryRaw: query } })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/health reports readiness after querying the database', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect('Cache-Control', 'no-store')
      .expect(200)
      .expect({ status: 'ok', database: 'up' });
    expect(query).toHaveBeenCalledOnce();
  });

  it('/health returns 503 without exposing database errors', async () => {
    query.mockRejectedValueOnce(new Error('sensitive database credentials'));
    await request(app.getHttpServer())
      .get('/health')
      .expect('Cache-Control', 'no-store')
      .expect(503)
      .expect({ status: 'error', database: 'down' });
  });

  it('/health/live stays healthy during a database outage', async () => {
    query.mockRejectedValueOnce(new Error('database unavailable'));
    await request(app.getHttpServer())
      .get('/health/live')
      .expect('Cache-Control', 'no-store')
      .expect(200)
      .expect({ status: 'ok' });
    expect(query).not.toHaveBeenCalled();
  });

  afterEach(async () => {
    await app.close();
  });
});
