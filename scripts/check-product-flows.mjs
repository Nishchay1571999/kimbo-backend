import { writeFile } from 'node:fs/promises';
import { HEALTH_PROFILE_REPOSITORY } from '../dist/modules/home/domain/health-profile.repository.js';
import { PrismaHealthProfileRepository } from '../dist/modules/home/infrastructure/prisma-health-profile.repository.js';
import { PrismaAnalysisWorkRepository } from '../dist/modules/ai/infrastructure/prisma-analysis-work.repository.js';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../dist/app.module.js';
import { PrismaService } from '../dist/common/database/prisma.service.js';
import { ENTRY_REPOSITORY } from '../dist/modules/entries/domain/entry.repository.js';
import { ANALYSIS_WORK_REPOSITORY } from '../dist/modules/ai/domain/analysis-work.repository.js';

// This opt-in check uses the existing test account, never changes its profile,
// and soft-deletes only the entries it creates. No provider secrets are logged.
process.env.DEV_AUTH_ENABLED = 'true';
process.env.DEV_USER_EMAIL = 'test@email.com';
delete process.env.DEV_USER_ID;
process.env.AI_WORKER_ENABLED = 'false';
let app;
let repository;
let user;
const created = [];
const report = {
  account: 'test@email.com',
  checkedAt: new Date().toISOString(),
  scope:
    'Live PostgreSQL and USDA; sleep profiles and successful AI output use rolled-back fixtures; OpenRouter adapter tested with fixtures',
  requests: [],
  checks: [],
};
try {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const prisma = app.get(PrismaService).client;
  repository = app.get(ENTRY_REPOSITORY);
  user = await prisma.user.findUniqueOrThrow({
    where: { email: 'test@email.com' },
    select: { id: true, authProviderId: true, onboardingCompletedAt: true },
  });
  const work = app.get(ANALYSIS_WORK_REPOSITORY);
  const request = async (
    path,
    method = 'GET',
    body,
    expected = 200,
    headers = {},
  ) => {
    const result = await fetch(`${base}/v1/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000),
    });
    assert.equal(
      result.status,
      expected,
      `${method} ${path}: unexpected status`,
    );
    const data = result.status === 204 ? null : await result.json();
    report.requests.push({
      method,
      path: `/v1/${path}`,
      status: result.status,
      ...(body === undefined ? {} : { request: body }),
      response: data,
    });
    return data;
  };
  const date = '2026-10-05';
  const baseline = await request(`home?date=${date}`);
  const models = await request('ai/models');
  assert.ok(
    models.length > 0 &&
      models.every((model) => model.supportsImages && model.supportsText),
  );
  assert.ok(models.every((model) => !('credentialReference' in model)));

  const portions = [];
  for (const [query, quantity] of [
    ['rice cooked', 150],
    ['chicken breast cooked', 100],
    ['yogurt plain', 100],
  ]) {
    const search = await request(
      `nutrition/search?q=${encodeURIComponent(query)}`,
    );
    assert.ok(search.foods.length > 0);
    const selected = search.foods.find(
      (food) => food.nutrition.caloriesKcal !== null,
    );
    assert.ok(selected, `No calorie reference for ${query}`);
    const food = await request(`nutrition/foods/${selected.providerFoodId}`);
    assert.equal(food.provider, 'usda-fdc');
    assert.equal(food.reference.quantity, 100);
    const portion = await request('nutrition/calculate', 'POST', {
      providerFoodId: food.providerFoodId,
      quantity,
      unit: 'g',
    });
    assert.equal(
      portion.caloriesKcal,
      Math.round(((food.nutrition.caloriesKcal * quantity) / 100) * 100) / 100,
    );
    for (const field of ['proteinG', 'carbohydratesG', 'fatG'])
      assert.equal(
        portion[field],
        food.nutrition[field] === null
          ? null
          : Math.round(food.nutrition[field] * quantity) / 100,
      );
    portions.push(portion);
  }
  const meal = await request(
    'entries',
    'POST',
    {
      category: 'nutrition',
      title: 'Rice, chicken and yogurt breakfast',
      entryDate: date,
      occurredAt: `${date}T08:15:00+05:30`,
      note: 'Breakfast after a morning walk',
      data: { mealCategory: 'breakfast', items: portions },
    },
    201,
  );
  created.push(meal.id);
  assert.equal(meal.ai.status, 'pending');
  assert.deepEqual(await request(`entries/${meal.id}`), meal);
  assert.ok(
    (await request(`entries?date=${date}`)).some((e) => e.id === meal.id),
  );
  const activity = await request(
    'entries',
    'POST',
    {
      category: 'exercise',
      title: 'Evening walk',
      entryDate: date,
      occurredAt: `${date}T18:00:00+05:30`,
      data: {
        activityName: 'Walking',
        durationMinutes: 30,
        intensity: 'moderate',
        estimatedCaloriesBurnedKcal: 120,
        calorieEstimationSource: 'user_entered',
      },
    },
    201,
  );
  created.push(activity.id);
  const eveningNote = await request(
    'entries',
    'POST',
    {
      category: 'note',
      title: 'Evening check-in',
      entryDate: date,
      occurredAt: `${date}T22:30:00+05:30`,
      note: 'Feeling tired after a busy day. Drank water and plan to sleep early.',
      data: {},
    },
    201,
  );
  created.push(eveningNote.id);
  const lateSnack = await request(
    'entries',
    'POST',
    {
      category: 'nutrition',
      title: 'Yogurt after midnight',
      entryDate: date,
      occurredAt: '2026-10-06T00:15:00+05:30',
      note: 'Late snack assigned to the prior reporting day',
      data: { mealCategory: 'snack', items: [portions[2]] },
    },
    201,
  );
  created.push(lateSnack.id);
  const nextDay = await request(
    'entries',
    'POST',
    {
      category: 'note',
      title: 'Next day check-in',
      entryDate: '2026-10-06',
      occurredAt: '2026-10-06T09:00:00+05:30',
      note: 'Feeling rested this morning.',
      data: {},
    },
    201,
  );
  created.push(nextDay.id);
  const dailyList = await request(`entries?date=${date}`);
  for (const entry of [meal, activity, eveningNote, lateSnack])
    assert.deepEqual(
      dailyList.find((row) => row.id === entry.id),
      entry,
    );
  assert.ok(!dailyList.some((row) => row.id === nextDay.id));
  assert.ok(
    (await request('entries?date=2026-10-06')).some(
      (row) => row.id === nextDay.id,
    ),
  );
  let home = await request(`home?date=${date}`);
  assert.equal(
    home.summary.nutrition.caloriesConsumedKcal,
    Math.round(
      (baseline.summary.nutrition.caloriesConsumedKcal +
        meal.summary.caloriesKcal +
        lateSnack.summary.caloriesKcal) *
        100,
    ) / 100,
  );
  assert.equal(
    home.summary.exercise.durationMinutes,
    baseline.summary.exercise.durationMinutes + 30,
  );
  assert.deepEqual(
    home.timeline.find(
      (item) => item.type === 'entry' && item.entry.id === meal.id,
    ).entry,
    meal,
  );
  assert.deepEqual(
    home.sections.map((section) => section.type),
    ['nutrition_summary', 'exercise_summary', 'timeline'],
  );
  assert.deepEqual(home.sections[0].data, home.summary.nutrition);
  assert.deepEqual(home.sections[2].data.entries, home.timeline);
  assert.equal(home.day.previous, '2026-10-04');
  assert.equal(home.day.next, '2026-10-06');
  assert.equal(home.day.weekday, 'Monday');
  assert.ok(
    !home.timeline.some(
      (item) => item.type === 'entry' && item.entry.id === nextDay.id,
    ),
  );
  const profiles = app.get(HEALTH_PROFILE_REPOSITORY);
  const originalGetProfile = profiles.get.bind(profiles);
  const actualProfile = await prisma.userHealthProfile.findUnique({
    where: { userId: user.id },
  });
  if (!actualProfile) {
    assert.deepEqual(home.schedule, {
      wakeTime: null,
      sleepTime: null,
      crossesMidnight: false,
    });
    // Verify persisted profile times through the real HTTP API while rolling back
    // all illustrative onboarding facts; do not change this account's profile.
    for (const sleepTime of ['00:30', '23:00']) {
      const rollbackProfile = new Error('rollback schedule fixture');
      try {
        await assert.rejects(
          prisma.$transaction(
            async (tx) => {
              await tx.userHealthProfile.create({
                data: {
                  userId: user.id,
                  heightCm: 170,
                  initialWeightKg: 70,
                  ageAtOnboarding: 30,
                  ageRecordedOn: new Date(date),
                  gender: 'unspecified',
                  goalIntention: 'maintain',
                  exerciseFrequency: 'once_or_twice',
                  healthyEatingFrequency: 'most_of_the_time',
                  defaultWakeTime: new Date('1970-01-01T07:00:00Z'),
                  defaultSleepTime: new Date(`1970-01-01T${sleepTime}:00Z`),
                },
              });
              const adapter = new PrismaHealthProfileRepository({ client: tx });
              profiles.get = (id) => adapter.get(id);
              const scheduled = await request(`home?date=${date}`);
              assert.deepEqual(scheduled.schedule, {
                wakeTime: '07:00',
                sleepTime,
                crossesMidnight: sleepTime === '00:30',
              });
              const sleep = scheduled.timeline.find(
                (item) => item.type === 'boundary' && item.boundary === 'sleep',
              );
              assert.deepEqual(sleep, {
                type: 'boundary',
                boundary: 'sleep',
                date: sleepTime === '00:30' ? '2026-10-06' : date,
                time: sleepTime,
              });
              const snack = scheduled.timeline.find(
                (item) =>
                  item.type === 'entry' && item.entry.id === lateSnack.id,
              );
              assert.equal(snack.outsideSchedule, sleepTime !== '00:30');
              assert.deepEqual(scheduled.summary, home.summary);
              throw rollbackProfile;
            },
            { timeout: 15000 },
          ),
          (error) => error === rollbackProfile,
        );
      } finally {
        profiles.get = originalGetProfile;
      }
    }
    assert.equal(
      await prisma.userHealthProfile.findUnique({ where: { userId: user.id } }),
      null,
    );
  }
  // Recalculate a realistic portion edit and verify list and Home see its snapshot.
  const largerRice = await request('nutrition/calculate', 'POST', {
    providerFoodId: portions[0].reference.providerFoodId,
    quantity: 200,
    unit: 'g',
  });
  largerRice.id = portions[0].id;
  const portionEdit = await request(`entries/${meal.id}`, 'PATCH', {
    revision: meal.revision,
    note: 'Changed rice from 150 g to 200 g',
    data: {
      mealCategory: 'breakfast',
      items: [largerRice, portions[1], portions[2]],
    },
  });
  assert.equal(
    portionEdit.summary.caloriesKcal,
    Math.round(
      [largerRice, portions[1], portions[2]].reduce(
        (sum, item) => sum + item.caloriesKcal,
        0,
      ) * 100,
    ) / 100,
  );
  const afterEdit = await request(`home?date=${date}`);
  assert.equal(
    afterEdit.summary.nutrition.caloriesConsumedKcal,
    Math.round(
      (home.summary.nutrition.caloriesConsumedKcal -
        meal.summary.caloriesKcal +
        portionEdit.summary.caloriesKcal) *
        100,
    ) / 100,
  );
  assert.deepEqual(
    (await request(`entries?date=${date}`)).find((row) => row.id === meal.id),
    portionEdit,
  );
  report.checks.push(
    'Every new HTTP endpoint exercised with realistic meals, exercise and notes',
    'Day navigation and semantic sections match Home data',
    'Sleep profiles: overnight 00:30 and same-day 23:00 (real database fixtures rolled back)',
    'Reporting date keeps after-midnight snack on assigned day',
    'USDA fetched portions survive create/read/list and larger-portion edit',
  );
  console.log(
    'PASS: realistic data for all product APIs, day sections, overnight/same-day sleep and USDA portion edits',
  );
  assert.equal(await repository.get(randomUUID(), meal.id), null);
  await assert.rejects(repository.delete(randomUUID(), meal.id), {
    status: 404,
  });
  await request(
    'entries',
    'POST',
    {
      category: 'nutrition',
      entryDate: date,
      occurredAt: `${date}T08:00:00Z`,
      data: { mealCategory: 'lunch', items: [] },
    },
    400,
  );
  await request(`entries?date=2026-02-30`, 'GET', undefined, 400);
  await request(`entries/${meal.id}`, 'GET', undefined, 401, {
    Authorization: 'Bearer invalid',
  });
  if (!user.onboardingCompletedAt)
    await request(`home?date=${date}`, 'GET', undefined, 403, {
      Authorization: `Bearer ${user.authProviderId}`,
    });
  const config = app.get(ConfigService);
  const nodeEnv = config.get('NODE_ENV');
  config.set('NODE_ENV', 'production');
  await request(`home?date=${date}`, 'GET', undefined, 401);
  config.set('NODE_ENV', nodeEnv);
  console.log(
    'PASS: live USDA search/detail/portion, create/read/list/Home, ownership, validation and production stub rejection',
  );

  const claimed = await work.claim(user.id, meal.id);
  assert.ok(claimed);
  assert.equal(await work.claim(user.id, meal.id), null);
  const edited = await request(`entries/${meal.id}`, 'PATCH', {
    revision: portionEdit.revision,
    note: 'Smoke test edited meal',
  });
  assert.ok(edited.revision > portionEdit.revision);
  assert.equal(edited.ai.status, 'pending');
  const registeredModel = await prisma.aiModel.findFirstOrThrow({
    where: {
      provider: 'openrouter',
      supportsImages: true,
      supportsText: true,
      isAvailable: true,
    },
  });
  const fakeOutput = {
    synopsis: 'Smoke test analysis fixture.',
    structured: { observations: ['Test observation'] },
    providerModelId: registeredModel.providerModelId,
    modelId: registeredModel.id,
  };
  // Stale work must be refused before even creating a model attribution row.
  assert.equal(await work.complete(user.id, claimed, fakeOutput), false);
  await work.fail(user.id, claimed, 'STALE_TEST');
  assert.equal((await request(`entries/${meal.id}`)).ai.status, 'pending');
  await request(
    `entries/${meal.id}`,
    'PATCH',
    { revision: meal.revision, note: 'Conflicting edit' },
    409,
  );
  const currentClaim = await work.claim(user.id, meal.id);
  assert.ok(currentClaim);
  assert.equal(
    await work.complete(randomUUID(), currentClaim, fakeOutput),
    false,
  );
  // Lease recovery uses a real persisted expired lease.
  await prisma.entityTagDetails.update({
    where: { id: currentClaim.detailsId },
    data: { aiLockedUntil: new Date(Date.now() - 1000) },
  });
  const recovered = await work.claim(user.id, meal.id);
  assert.ok(recovered);
  assert.equal(recovered.attempt, 2);
  assert.equal(await work.complete(user.id, currentClaim, fakeOutput), false);
  await work.fail(user.id, recovered, 'AI_NETWORK_ERROR');
  assert.equal((await request(`entries/${meal.id}`)).ai.status, 'pending');
  assert.equal(await work.claim(user.id, meal.id), null); // respects backoff
  await prisma.entityTagDetails.update({
    where: { id: recovered.detailsId },
    data: { aiNextAttemptAt: new Date(0) },
  });
  const last = await work.claim(user.id, meal.id);
  assert.equal(last.attempt, 3);
  await work.fail(user.id, last, 'AI_NETWORK_ERROR');
  assert.equal((await request(`entries/${meal.id}`)).ai.status, 'failed');
  assert.equal(await work.claim(user.id, meal.id), null);
  console.log(
    'PASS: exclusive AI claim, stale output rejection, edit conflicts, lease recovery, retry backoff and retry limit',
  );

  // Exercise successful persistence inside an outer transaction that is rolled
  // back. Only an already registered model can be attributed.
  const retry = await request(`entries/${meal.id}`, 'PATCH', {
    note: 'Completed fixture verification',
  });
  const success = await work.claim(user.id, meal.id);
  const rollback = new Error('rollback analysis fixture');
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const scoped = new PrismaAnalysisWorkRepository({
        client: { $transaction: (callback) => callback(tx) },
      });
      assert.equal(await scoped.complete(user.id, success, fakeOutput), true);
      const row = await tx.entity.findUniqueOrThrow({
        where: { entityId: meal.id },
        include: { details: true },
      });
      assert.equal(row.details.aiStatus, 'completed');
      assert.equal(row.revision, retry.revision);
      assert.equal(row.details.aiSynopsis, fakeOutput.synopsis);
      assert.deepEqual(row.details.aiStructuredData, fakeOutput.structured);
      throw rollback;
    }),
    (error) => error === rollback,
  );
  assert.equal((await request(`entries/${meal.id}`)).ai.status, 'processing');
  assert.equal(
    (await prisma.aiModel.findUnique({ where: { id: registeredModel.id } }))
      .providerModelId,
    registeredModel.providerModelId,
  );
  console.log(
    'PASS: successful analysis persistence and attribution preserve content revision (fixture transaction rolled back)',
  );
  for (const id of created)
    await request(`entries/${id}`, 'DELETE', undefined, 204);
  await request(`entries/${meal.id}`, 'GET', undefined, 404);
  home = await request(`home?date=${date}`);
  assert.deepEqual(home.summary, baseline.summary);
  console.log(
    'PASS: soft delete removes entries from reporting; Home totals restored',
  );
  report.checks.push(
    'Ownership and production authentication',
    'AI stale revision, lease recovery, backoff, retry limit and rollback-only success',
    'Soft-deletion restores original totals',
  );
  await writeFile(
    new URL('../docs/product-api-verification.json', import.meta.url),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    'Saved request/response evidence: docs/product-api-verification.json',
  );
} catch (error) {
  // Assertion messages contain no database URLs or provider credentials.
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : `Product check failed (${error?.code ?? error?.status ?? error?.name ?? 'unknown'})`,
  );
  process.exitCode = 1;
} finally {
  if (repository && user)
    for (const id of created) {
      if (await repository.get(user.id, id))
        await repository.delete(user.id, id);
    }
  await app?.close();
}
