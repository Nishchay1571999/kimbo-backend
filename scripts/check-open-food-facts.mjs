import 'dotenv/config';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../dist/app.module.js';
import { PrismaService } from '../dist/common/database/prisma.service.js';
import { ENTRY_REPOSITORY } from '../dist/modules/entries/domain/entry.repository.js';
process.env.DEV_AUTH_ENABLED = 'true';
process.env.DEV_USER_EMAIL = 'test@email.com';
delete process.env.DEV_USER_ID;
process.env.AI_WORKER_ENABLED = 'false';
let app, repository, user;
const ids = [];
const report = {
  account: 'test@email.com',
  checkedAt: new Date().toISOString(),
  provider: 'open-food-facts',
  environment: process.argv.includes('--production') ? 'production' : 'staging',
  requests: [],
  checks: [],
};
try {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  app.get(ConfigService).set('OPEN_FOOD_FACTS_ENVIRONMENT', report.environment);
  user = await app
    .get(PrismaService)
    .client.user.findUniqueOrThrow({
      where: { email: 'test@email.com' },
      select: { id: true },
    });
  repository = app.get(ENTRY_REPOSITORY);
  const request = async (path, method = 'GET', body, expected = 200) => {
    const response = await fetch(`${base}/v1/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(25000),
    });
    const data = response.status === 204 ? null : await response.json();
    report.requests.push({
      method,
      path,
      status: response.status,
      ...(body === undefined ? {} : { body }),
      response: data,
    });
    assert.equal(
      response.status,
      expected,
      `${method} ${path}: ${data?.message ?? 'unexpected status'}`,
    );
    return data;
  };
  const baseline = await request('home?date=2026-10-05');
  const search = await request(
    'nutrition/search?provider=open-food-facts&q=Nutella',
  );
  assert.ok(search.foods.length > 0);
  assert.ok(search.foods.every((food) => food.provider === 'open-food-facts'));
  const food = await request(
    'nutrition/foods/3017624010701?provider=open-food-facts',
  );
  assert.equal(food.providerFoodId, '3017624010701');
  assert.equal(food.provider, 'open-food-facts');
  assert.ok(food.nutrition.caloriesKcal > 0);
  const portion = await request('nutrition/calculate', 'POST', {
    provider: 'open-food-facts',
    providerFoodId: food.providerFoodId,
    quantity: 15,
    unit: 'g',
  });
  assert.equal(
    portion.caloriesKcal,
    Math.round(food.nutrition.caloriesKcal * 0.15 * 100) / 100,
  );
  const created = await request(
    'entries',
    'POST',
    {
      category: 'nutrition',
      title: 'Nutella snack',
      entryDate: '2026-10-05',
      occurredAt: '2026-10-05T16:00:00+05:30',
      note: '15 g of Nutella, nutrition confirmed from Open Food Facts',
      data: { mealCategory: 'snack', items: [portion] },
    },
    201,
  );
  ids.push(created.id);
  assert.deepEqual(created.data.items[0], portion);
  assert.equal(created.summary.caloriesKcal, portion.caloriesKcal);
  assert.deepEqual(
    (await request(`entries/${created.id}`)).data.items[0],
    portion,
  );
  assert.deepEqual(
    (await request('entries?date=2026-10-05')).find(
      (entry) => entry.id === created.id,
    ).data.items[0],
    portion,
  );
  const home = await request('home?date=2026-10-05');
  assert.equal(
    home.summary.nutrition.caloriesConsumedKcal,
    Math.round(
      (baseline.summary.nutrition.caloriesConsumedKcal + portion.caloriesKcal) *
        100,
    ) / 100,
  );
  await request(
    'nutrition/search?provider=unknown&q=Nutella',
    'GET',
    undefined,
    400,
  );
  await request(
    'nutrition/foods/invalid?provider=open-food-facts',
    'GET',
    undefined,
    400,
  );
  await request(`entries/${created.id}`, 'DELETE', undefined, 204);
  assert.deepEqual(
    (await request('home?date=2026-10-05')).summary,
    baseline.summary,
  );
  report.checks.push(
    'Live Open Food Facts full-text search and barcode lookup',
    '15 g portion calculation with provider provenance',
    'Confirmed snapshot survives entry create/detail/list',
    'Home aggregates Open Food Facts nutrition',
    'Invalid provider/barcode rejected',
    'Soft-deletion restores baseline totals',
  );
  console.log(
    JSON.stringify({
      name: food.name,
      barcode: food.providerFoodId,
      reference: food.reference,
      nutrition: food.nutrition,
      portionKcal: portion.caloriesKcal,
      checks: report.checks,
    }),
  );
} catch (error) {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : `Open Food Facts check failed (${error?.code ?? error?.name ?? 'unknown'})`,
  );
  process.exitCode = 1;
} finally {
  if (repository && user)
    for (const id of ids)
      if (await repository.get(user.id, id))
        await repository.delete(user.id, id);
  await app?.close();
  await writeFile(
    new URL('../docs/open-food-facts-verification.json', import.meta.url),
    JSON.stringify(report, null, 2) + '\n',
  );
}
