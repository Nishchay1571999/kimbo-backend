import { AI_MODEL_REPOSITORY } from '../src/modules/ai/domain/ai-model.repository.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/common/database/prisma.service.js';
import { ENTRY_REPOSITORY } from '../src/modules/entries/domain/entry.repository.js';
import { HEALTH_PROFILE_REPOSITORY } from '../src/modules/home/domain/health-profile.repository.js';
import {
  NUTRITION_PROVIDER,
  OPEN_FOOD_FACTS_PROVIDER,
} from '../src/modules/nutrition/domain/nutrition-provider.js';
import type {
  Entry,
  EntryContent,
} from '../src/modules/entries/domain/entry.types.js';

const userId = '45dcf7b4-8ebd-4468-9b1c-ad85a3265c6a';
const entryId = '923fdc43-e916-4326-bb6d-2603a9525ba0';
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const body = {
  category: 'nutrition',
  title: 'Breakfast',
  note: 'A bowl of rice',
  entryDate: '2026-10-05',
  occurredAt: '2026-10-05T08:15:00+05:30',
  attachments: [
    { id: 'photo', type: 'image', mimeType: 'image/png', base64: png },
  ],
  data: {
    mealCategory: 'breakfast',
    items: [{ name: 'Rice', quantity: 150, unit: 'g', caloriesKcal: 195 }],
  },
};
const food = {
  id: 'usda:1',
  provider: 'usda-fdc',
  providerFoodId: '1',
  name: 'Rice',
  reference: { quantity: 100, unit: 'g' },
  nutrition: {
    caloriesKcal: 130,
    proteinG: 2.7,
    carbohydratesG: null,
    fatG: null,
  },
};
describe('product HTTP contracts', () => {
  let app: INestApplication;
  let current: Entry;
  const settings = new Map<string, string>();
  const findUser = vi.fn();
  const create = vi.fn();
  const get = vi.fn();
  const list = vi.fn();
  const update = vi.fn();
  const remove = vi.fn();
  beforeEach(async () => {
    settings.clear();
    settings.set('DEV_AUTH_ENABLED', 'true');
    settings.set('NODE_ENV', 'test');
    findUser.mockReset().mockResolvedValue({
      id: userId,
      timezone: 'Asia/Kolkata',
      onboardingCompletedAt: null,
    });
    create
      .mockReset()
      .mockImplementation(async (_userId: string, content: EntryContent) => {
        current = {
          ...content,
          id: entryId,
          revision: 1,
          createdAt: '',
          updatedAt: '',
          summary: { caloriesKcal: 195 },
          ai: { status: 'pending', synopsis: null },
        };
        return current;
      });
    get.mockReset().mockImplementation(async () => current ?? null);
    list.mockReset().mockResolvedValue([]);
    update.mockReset();
    remove.mockReset();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue({ get: (key: string) => settings.get(key) })
      .overrideProvider(PrismaService)
      .useValue({ client: { user: { findUnique: findUser } } })
      .overrideProvider(ENTRY_REPOSITORY)
      .useValue({ create, get, list, update, delete: remove })
      .overrideProvider(HEALTH_PROFILE_REPOSITORY)
      .useValue({
        get: async () => ({
          timezone: 'Asia/Kolkata',
          wakeTime: '07:00',
          sleepTime: '00:30',
        }),
      })
      .overrideProvider(AI_MODEL_REPOSITORY)
      .useValue({
        list: async () => [
          {
            id: 'allowed',
            name: 'Vision',
            provider: 'openrouter',
            providerModelId: 'listed-model',
            supportsText: true,
            supportsImages: true,
            supportsAudio: false,
          },
        ],
      })
      .overrideProvider(OPEN_FOOD_FACTS_PROVIDER)
      .useValue({
        getFood: async (id: string) => ({
          ...food,
          id: `open-food-facts:${id}`,
          provider: 'open-food-facts',
          providerFoodId: id,
        }),
        searchFoods: async () => ({
          foods: [
            {
              ...food,
              id: 'open-food-facts:0030000012000',
              provider: 'open-food-facts',
              providerFoodId: '0030000012000',
            },
          ],
          totalHits: 1,
          totalPages: 1,
          page: 1,
        }),
      })
      .overrideProvider(NUTRITION_PROVIDER)
      .useValue({
        getFood: async () => food,
        searchFoods: async () => ({
          foods: [food],
          totalHits: 1,
          totalPages: 1,
          page: 1,
        }),
      })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
  });
  it('creates with the resolved test identity and uses the same entry shape in Home', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/entries')
      .send(body)
      .expect(201);
    expect(findUser).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'test@email.com' } }),
    );
    expect(create).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        category: 'nutrition',
        recordedTimezone: 'Asia/Kolkata',
      }),
    );
    list.mockResolvedValue([current]);
    const home = await request(app.getHttpServer())
      .get('/v1/home?date=2026-10-05')
      .expect(200);
    expect(home.body.summary.nutrition.caloriesConsumedKcal).toBe(195);
    expect(
      home.body.timeline.find((item: { type: string }) => item.type === 'entry')
        .entry,
    ).toEqual(created.body);
    expect(list).toHaveBeenCalledWith(userId, '2026-10-05');
  });
  it('lists only configured model DTOs and round-trips Base64 attachments', async () => {
    const models = await request(app.getHttpServer())
      .get('/v1/ai/models')
      .expect(200);
    expect(models.body[0]).toMatchObject({
      id: 'allowed',
      supportsImages: true,
    });
    expect(models.body[0]).not.toHaveProperty('credentialReference');
    const base64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    const photo = await request(app.getHttpServer())
      .post('/v1/entries')
      .send({
        category: 'note',
        entryDate: '2026-10-05',
        occurredAt: '2026-10-05T08:15:00Z',
        attachments: [{ type: 'image', mimeType: 'image/png', base64 }],
        data: {},
      })
      .expect(201);
    expect(photo.body.attachments[0]).toMatchObject({
      base64,
      fileSizeBytes: Buffer.from(base64, 'base64').length,
    });
    expect(photo.body.attachments[0]).not.toHaveProperty('storageKey');
    const fetched = await request(app.getHttpServer())
      .get(`/v1/entries/${entryId}`)
      .expect(200);
    expect(fetched.body.attachments).toEqual(photo.body.attachments);
  });
  it('accepts and returns audio Base64 through creation, detail and listing', async () => {
    const bytes = Buffer.alloc(44);
    bytes.write('RIFF');
    bytes.writeUInt32LE(36, 4);
    bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(16000, 24);
    bytes.writeUInt32LE(32000, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36);
    const base64 = bytes.toString('base64');
    const audio = await request(app.getHttpServer())
      .post('/v1/entries')
      .send({
        category: 'note',
        entryDate: '2026-10-05',
        occurredAt: '2026-10-05T20:00:00Z',
        attachments: [{ type: 'audio', mimeType: 'audio/wav', base64 }],
        data: {},
      })
      .expect(201);
    expect(audio.body.attachments[0]).toMatchObject({
      type: 'audio',
      base64,
      fileSizeBytes: 44,
    });
    expect(audio.body.inputSource).toBe('audio');
    const detail = await request(app.getHttpServer())
      .get(`/v1/entries/${entryId}`)
      .expect(200);
    expect(detail.body.attachments[0].base64).toBe(base64);
    list.mockResolvedValue([current]);
    const entries = await request(app.getHttpServer())
      .get('/v1/entries?date=2026-10-05')
      .expect(200);
    expect(entries.body[0].attachments[0].base64).toBe(base64);
  });
  it('rejects owner spoofing, malformed date, invalid UUID and empty meals', async () => {
    await request(app.getHttpServer())
      .post('/v1/entries')
      .send({ ...body, userId: 'other' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/v1/entries')
      .send({ ...body, data: { mealCategory: 'lunch', items: [] } })
      .expect(400);
    await request(app.getHttpServer())
      .post('/v1/entries')
      .send({ ...body, attachments: [] })
      .expect(400);
    await request(app.getHttpServer())
      .post('/v1/entries')
      .send({ ...body, note: ' ' })
      .expect(400);
    await request(app.getHttpServer())
      .get('/v1/entries?date=2026-02-30')
      .expect(400);
    await request(app.getHttpServer())
      .get('/v1/entries/not-a-uuid')
      .expect(400);
    expect(create).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
  it('passes owner and expected revision to edits and soft deletion', async () => {
    await request(app.getHttpServer())
      .post('/v1/entries')
      .send(body)
      .expect(201);
    update.mockResolvedValue({ ...current, revision: 2, note: 'Changed' });
    await request(app.getHttpServer())
      .patch(`/v1/entries/${entryId}`)
      .send({ revision: 1, note: 'Changed' })
      .expect(200);
    expect(update).toHaveBeenCalledWith(
      userId,
      entryId,
      expect.objectContaining({ note: 'Changed' }),
      1,
    );
    await request(app.getHttpServer())
      .delete(`/v1/entries/${entryId}`)
      .expect(204);
    expect(remove).toHaveBeenCalledWith(userId, entryId);
  });
  it('normalizes food details and calculates a confirmed portion', async () => {
    await request(app.getHttpServer())
      .get('/v1/nutrition/search?q=rice')
      .expect(200);
    await request(app.getHttpServer()).get('/v1/nutrition/foods/1').expect(200);
    const result = await request(app.getHttpServer())
      .post('/v1/nutrition/calculate')
      .send({ providerFoodId: '1', quantity: 150, unit: 'g' })
      .expect(200);
    expect(result.body).toMatchObject({
      quantity: 150,
      caloriesKcal: 195,
      proteinG: 4.05,
      nutritionSource: 'reference',
    });
    await request(app.getHttpServer())
      .post('/v1/nutrition/calculate')
      .send({ providerFoodId: '1', quantity: 2, unit: 'piece' })
      .expect(400);
  });
  it('routes Open Food Facts search, barcode detail and portions through Nutrition', async () => {
    const search = await request(app.getHttpServer())
      .get('/v1/nutrition/search?provider=open-food-facts&q=cereal')
      .expect(200);
    expect(search.body.foods[0].provider).toBe('open-food-facts');
    const detail = await request(app.getHttpServer())
      .get('/v1/nutrition/foods/0030000012000?provider=open-food-facts')
      .expect(200);
    expect(detail.body.providerFoodId).toBe('0030000012000');
    const portion = await request(app.getHttpServer())
      .post('/v1/nutrition/calculate')
      .send({
        provider: 'open-food-facts',
        providerFoodId: '0030000012000',
        quantity: 150,
        unit: 'g',
      })
      .expect(200);
    expect(portion.body).toMatchObject({
      caloriesKcal: 195,
      reference: {
        provider: 'open-food-facts',
        providerFoodId: '0030000012000',
      },
    });
    await request(app.getHttpServer())
      .get('/v1/nutrition/search?provider=unknown&q=cereal')
      .expect(400);
    await request(app.getHttpServer())
      .get('/v1/nutrition/foods/abc?provider=open-food-facts')
      .expect(400);
  });
  it('disables the stub in production, resolves bearer identity and enforces onboarding', async () => {
    settings.set('NODE_ENV', 'production');
    await request(app.getHttpServer()).get('/v1/home').expect(401);
    expect(findUser).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .get('/v1/home')
      .set('Authorization', 'Bearer test-token')
      .expect(403);
    expect(findUser).toHaveBeenCalledWith(
      expect.objectContaining({ where: { authProviderId: 'test-token' } }),
    );
    findUser.mockResolvedValue({
      id: userId,
      timezone: 'UTC',
      onboardingCompletedAt: new Date(),
    });
    await request(app.getHttpServer())
      .get('/v1/home')
      .set('Authorization', 'Bearer test-token')
      .expect(200);
    findUser.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get('/v1/home')
      .set('Authorization', 'Bearer invalid')
      .expect(401);
  });
});
