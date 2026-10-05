import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createPrismaClient } from '../dist/common/database/prisma-client.js';
import {
  reportingDate,
  localDate,
  shiftDate,
} from '../dist/common/time/calendar.js';
import { roundToTwoDecimals } from '../dist/common/math/round.js';
import { entryInput } from '../dist/modules/entries/application/entry-input.js';
import { PrismaEntryRepository } from '../dist/modules/entries/infrastructure/prisma-entry.repository.js';
import { PrismaHealthProfileRepository } from '../dist/modules/home/infrastructure/prisma-health-profile.repository.js';
import { PrismaAiModelRepository } from '../dist/modules/ai/infrastructure/prisma-ai-model.repository.js';
import { buildHome } from '../dist/modules/home/application/get-home/get-home.use-case.js';

// Opt-in fixtures for this account only. No provider calls, passwords, token
// changes, deletes, or schema changes. Reruns for the same date are additive
// and idempotent; all writes commit together under a lock on this user.
const email = 'test@email.com';
const fixture = 'kimbo-dummy-v1';
const prisma = createPrismaClient(process.env.DATABASE_URL);
const report = { account: email, fixture, checkedAt: new Date().toISOString() };
let stage = 'connect';
try {
  await prisma.$connect();
  const result = await prisma.$transaction(
    async (tx) => {
      stage = 'load test account';
      const locked =
        await tx.$queryRaw`SELECT id FROM users WHERE email = ${email} FOR UPDATE`;
      assert.equal(locked.length, 1, 'Existing test account required');
      const user = await tx.user.findUniqueOrThrow({ where: { email } });
      const dateOption = process.argv.find((arg) => arg.startsWith('--date='));
      const anchorDate = reportingDate(
        dateOption?.slice(7) ?? localDate(new Date(), user.timezone),
      );
      const namespace = `${fixture}:${user.id}:${anchorDate}`;
      const stableId = (key) => {
        const bytes = createHash('sha256')
          .update(`${namespace}:${key}`)
          .digest()
          .subarray(0, 16);
        bytes[6] = (bytes[6] & 0x0f) | 0x50;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = bytes.toString('hex');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      };
      const created = {
        entries: 0,
        healthRecords: 0,
        threads: 0,
        messages: 0,
        profiles: 0,
      };
      const adapter = { client: tx };
      const entries = new PrismaEntryRepository(adapter);
      const profiles = new PrismaHealthProfileRepository(adapter);
      const models = new PrismaAiModelRepository(adapter);
      const model = await models.selectForEntry(user.id, false);
      assert.ok(
        model,
        'Register an available model with ai:configure before seeding',
      );

      stage = 'onboarding';
      if (
        !(await tx.userHealthProfile.findUnique({ where: { userId: user.id } }))
      ) {
        await tx.userHealthProfile.create({
          data: {
            userId: user.id,
            heightCm: 176,
            initialWeightKg: 75.2,
            ageAtOnboarding: 29,
            ageRecordedOn: new Date(anchorDate),
            gender: 'unspecified',
            goalIntention: 'maintain',
            exerciseFrequency: 'four_to_five_plus',
            healthyEatingFrequency: 'most_of_the_time',
            defaultWakeTime: new Date('1970-01-01T07:30:00Z'),
            defaultSleepTime: new Date('1970-01-01T23:30:00Z'),
          },
        });
        created.profiles++;
      }
      if (!user.onboardingCompletedAt) {
        await tx.user.update({
          where: { id: user.id },
          data: { onboardingCompletedAt: new Date() },
        });
      }
      await tx.userPreferences.upsert({
        where: { userId: user.id },
        create: { userId: user.id, preferredChatModelId: model.id },
        update: {},
      });
      const profile = await profiles.get(user.id);
      const identity = {
        userId: user.id,
        timezone: user.timezone,
        development: false,
      };
      const seeded = [];
      const add = async (date, key, time, category, title, data) => {
        const marker = `${namespace}:${date}:${key}`;
        const existing = await tx.entity.findFirst({
          where: { userId: user.id, details: { note: marker } },
          select: { entityId: true, deletedAt: true },
        });
        // Preserve edits and soft deletions rather than resurrecting fixtures.
        if (existing?.deletedAt) return;
        let entry = existing
          ? await entries.get(user.id, existing.entityId)
          : null;
        if (!entry) {
          // Fixtures use this test account's Asia/Kolkata wall-clock times.
          entry = await entries.create(
            user.id,
            entryInput(
              {
                category,
                title: `[Dummy] ${title}`,
                note: marker,
                entryDate: date,
                occurredAt: `${date}T${time}:00+05:30`,
                data,
              },
              identity,
            ),
          );
          await tx.entityTagDetails.update({
            where: {
              id: (
                await tx.entity.findUniqueOrThrow({
                  where: { entityId: entry.id },
                })
              ).entityTagDetailsId,
            },
            data: { aiStatus: 'not_requested', aiNextAttemptAt: null },
          });
          entry = await entries.get(user.id, entry.id);
          created.entries++;
        }
        seeded.push(entry);
        const kcal =
          category === 'nutrition'
            ? entry.summary.caloriesKcal
            : category === 'exercise'
              ? entry.data.estimatedCaloriesBurnedKcal
              : null;
        if (kcal !== null) {
          const metricType =
            category === 'nutrition' ? 'calories_intake' : 'calories_burned';
          const where = {
            sourceEntityId_sourceRevision_metricType: {
              sourceEntityId: entry.id,
              sourceRevision: entry.revision,
              metricType,
            },
          };
          if (!(await tx.healthRecord.findUnique({ where }))) {
            await tx.healthRecord.create({
              data: {
                id: stableId(`calories:${entry.id}:${entry.revision}`),
                userId: user.id,
                metricType,
                value: kcal,
                unit: 'kcal',
                occurredAt: new Date(entry.occurredAt),
                sourceEntityId: entry.id,
                sourceRevision: entry.revision,
                source: 'calculated',
              },
            });
            created.healthRecords++;
          }
        }
      };
      const meal = (name, kcal, proteinG, carbohydratesG, fatG) => ({
        name,
        quantity: 1,
        unit: 'portion',
        caloriesKcal: kcal,
        proteinG,
        carbohydratesG,
        fatG,
        nutritionSource: 'user_entered',
      });
      stage = 'health entries';
      const from = shiftDate(anchorDate, -20);
      for (let offset = 0; offset < 21; offset++) {
        // Missing days are intentional, for testing tracked-day averages.
        if (offset === 7 || offset === 14) continue;
        const date = shiftDate(from, offset);
        const adjustment = (offset % 4) * 30;
        await add(
          date,
          'breakfast',
          '08:00',
          'nutrition',
          'Oats, yogurt and banana',
          {
            mealCategory: 'breakfast',
            items: [
              meal(
                'Oats, yogurt and banana (dummy)',
                420 + adjustment,
                22,
                65,
                12,
              ),
            ],
          },
        );
        await add(
          date,
          'lunch',
          '13:00',
          'nutrition',
          'Rice, dal and vegetables',
          {
            mealCategory: 'lunch',
            items: [
              meal(
                'Rice, dal and vegetables (dummy)',
                620 + adjustment,
                28,
                90,
                18,
              ),
            ],
          },
        );
        if (date !== anchorDate) {
          await add(
            date,
            'dinner',
            '20:00',
            'nutrition',
            'Roti, paneer and salad',
            {
              mealCategory: 'dinner',
              items: [meal('Roti, paneer and salad (dummy)', 680, 34, 70, 26)],
            },
          );
        }
        if (new Date(date).getUTCDay() === 6) {
          await add(
            date,
            'snack',
            '17:00',
            'nutrition',
            'Pizza and ice cream',
            {
              mealCategory: 'snack',
              items: [meal('Pizza and ice cream (dummy)', 720, 18, 94, 32)],
            },
          );
        }
        if (offset % 2 === 0) {
          await add(
            date,
            'exercise',
            '07:45',
            'exercise',
            'Brisk morning walk',
            {
              activityName: 'Walking (dummy)',
              durationMinutes: 35,
              intensity: 'moderate',
              estimatedCaloriesBurnedKcal: 180,
              calorieEstimationSource:
                'Synthetic test fixture, not a measured expenditure',
            },
          );
        }
        if (offset === 5 || offset === 20) {
          await add(
            date,
            'note',
            '15:00',
            'note',
            'Energy and hydration check-in',
            {},
          );
        }
      }
      stage = 'weight history';
      const weights = [];
      for (const [offset, value] of [
        [-20, 75.2],
        [-14, 74.9],
        [-7, 74.6],
        [-3, 74.4],
        [0, 74.2],
      ]) {
        const id = stableId(`weight:${offset}`);
        if (!(await tx.healthRecord.findUnique({ where: { id } }))) {
          await tx.healthRecord.create({
            data: {
              id,
              userId: user.id,
              metricType: 'weight',
              value,
              unit: 'kg',
              occurredAt: new Date(
                `${shiftDate(anchorDate, offset)}T07:00:00+05:30`,
              ),
              source: 'user',
            },
          });
          created.healthRecords++;
        }
        weights.push({
          id,
          valueKg: value,
          date: shiftDate(anchorDate, offset),
        });
      }

      // Reuse Home's exact calculations and persisted entry revisions for source
      // snapshots. These are explicitly simulated conversations, never AI output.
      const day = (date) =>
        buildHome(
          date,
          profile,
          seeded.filter((e) => e.entryDate === date),
        );
      const provenance = (items) => ({
        entities: items.map((e) => ({ entityId: e.id, revision: e.revision })),
        healthRecordIds: [],
      });
      const source = (key, type, title, snapshot, items = []) => ({
        id: stableId(`source:${key}`),
        type,
        title,
        toolCallId: stableId(`tool:${key}`),
        query: {
          from: snapshot.from ?? snapshot.date ?? from,
          to: snapshot.to ?? snapshot.date ?? anchorDate,
        },
        period: {
          from: snapshot.from ?? snapshot.date ?? from,
          to: snapshot.to ?? snapshot.date ?? anchorDate,
          timezone: user.timezone,
        },
        snapshot,
        provenance: provenance(items),
        fixture: true,
      });
      const days = Array.from({ length: 7 }, (_, i) => {
        const date = shiftDate(anchorDate, i - 6);
        const home = day(date);
        return {
          date,
          ...home.summary,
          tracked: seeded.some((e) => e.entryDate === date),
        };
      });
      const nutritionDays = days.filter((d) => d.nutrition.entryCount > 0);
      const weekly = {
        from: shiftDate(anchorDate, -6),
        to: anchorDate,
        timezone: user.timezone,
        summary: {
          daysInRange: 7,
          daysTracked: days.filter((d) => d.tracked).length,
          daysWithNutrition: nutritionDays.length,
          caloriesConsumedKcal: roundToTwoDecimals(
            days.reduce((sum, d) => sum + d.nutrition.caloriesConsumedKcal, 0),
          ),
          averageCaloriesConsumedKcal: nutritionDays.length
            ? roundToTwoDecimals(
                nutritionDays.reduce(
                  (sum, d) => sum + d.nutrition.caloriesConsumedKcal,
                  0,
                ) / nutritionDays.length,
              )
            : null,
          exerciseDurationMinutes: days.reduce(
            (sum, d) => sum + d.exercise.durationMinutes,
            0,
          ),
        },
        days,
      };
      const weekEntries = seeded.filter((e) => e.entryDate >= weekly.from);
      const high = [...days].sort(
        (a, b) =>
          b.nutrition.caloriesConsumedKcal - a.nutrition.caloriesConsumedKcal,
      )[0];
      const highEntries = weekEntries.filter(
        (e) => e.entryDate === high.date && e.category === 'nutrition',
      );
      const todaySource = source(
        'today',
        'daily_health',
        'Today (dummy)',
        day(anchorDate),
        seeded.filter((e) => e.entryDate === anchorDate),
      );
      const yesterday = shiftDate(anchorDate, -1);
      const yesterdaySource = source(
        'yesterday',
        'daily_health',
        'Yesterday (dummy)',
        day(yesterday),
        seeded.filter((e) => e.entryDate === yesterday),
      );
      const weekSource = source(
        'week',
        'weekly_health',
        'Last seven days (dummy)',
        weekly,
        weekEntries,
      );
      const entrySource = source(
        'entries',
        'entries',
        `Meals on ${high.date} (dummy)`,
        { date: high.date, entries: highEntries },
        highEntries,
      );
      const weightSource = source(
        'weight',
        'metric_history',
        'Weight history (dummy)',
        { from, to: anchorDate, metric: 'weight', records: weights },
      );
      weightSource.provenance.healthRecordIds = weights.map((w) => w.id);
      stage = 'chat fixtures';
      const makeThread = async (key, title, turns) => {
        const id = stableId(`thread:${key}`);
        if (await tx.chatThread.findUnique({ where: { id } })) return;
        await tx.chatThread.create({
          data: {
            id,
            userId: user.id,
            aiModelId: model.id,
            title: `[Dummy] ${title}`,
          },
        });
        created.threads++;
        for (const [index, turn] of turns.entries()) {
          const requestId = stableId(`request:${key}:${index}`);
          const userMessageId = stableId(`user:${key}:${index}`);
          const status = turn.status ?? 'completed';
          await tx.chatMessage.create({
            data: {
              id: userMessageId,
              threadId: id,
              role: 'user',
              status: 'completed',
              sequenceNumber: index * 2 + 1,
              requestId,
              message: turn.question,
              completedAt: new Date(),
              metadata: { fixture, aiGenerated: false },
            },
          });
          await tx.chatMessage.create({
            data: {
              id: stableId(`assistant:${key}:${index}`),
              threadId: id,
              role: 'assistant',
              status,
              sequenceNumber: index * 2 + 2,
              requestId,
              replyToMessageId: userMessageId,
              message: turn.answer ?? '',
              errorCode: turn.errorCode ?? null,
              completedAt: new Date(),
              actualModelId: null,
              metadata: {
                fixture,
                aiGenerated: false,
                simulated: true,
                agent: {
                  version: 1,
                  toolCalls: (turn.sources ?? []).map((s) => ({
                    id: s.toolCallId,
                    name: {
                      daily_health: 'get_day_health',
                      weekly_health: 'get_health_range',
                      entries: 'get_entries',
                      metric_history: 'get_health_metric_history',
                    }[s.type],
                    status: 'completed',
                    simulated: true,
                  })),
                },
                sources: turn.sources ?? [],
              },
            },
          });
          created.messages += 2;
        }
      };
      await makeThread('daily', 'Daily health check-in', [
        {
          question: 'How am I doing today?',
          answer: `Dummy response: You have logged ${todaySource.snapshot.summary.nutrition.caloriesConsumedKcal} kcal so far today. Exercise expenditure is separate. This is a partial day, and no calorie allowance is configured.`,
          sources: [todaySource],
        },
        {
          question: 'How did I eat yesterday?',
          answer: `Dummy response: Yesterday you logged ${yesterdaySource.snapshot.summary.nutrition.caloriesConsumedKcal} kcal across ${yesterdaySource.snapshot.summary.nutrition.entryCount} nutrition entries.`,
          sources: [yesterdaySource],
        },
        {
          question: 'How has my weight changed?',
          answer:
            'Dummy response: The synthetic measurements go from 75.2 kg to 74.2 kg. These fixtures are for testing, not clinical interpretation.',
          sources: [weightSource],
        },
      ]);
      await makeThread('weekly', 'Weekly patterns and meal drill-down', [
        {
          question: 'How have I eaten over the last seven days?',
          answer: `Dummy response: You logged nutrition on ${nutritionDays.length} of 7 days, averaging ${weekly.summary.averageCaloriesConsumedKcal} kcal per nutrition-tracked day. Missing days are excluded, and today is only partially logged.`,
          sources: [weekSource],
        },
        {
          question: 'Which day was higher, and what did I eat?',
          answer: `Dummy response: ${high.date} had the highest logged intake at ${high.nutrition.caloriesConsumedKcal} kcal. Its saved meals are included in the source snapshot.`,
          sources: [weekSource, entrySource],
        },
      ]);
      await makeThread('states', 'Failed and cancelled response examples', [
        {
          question: 'Show my weekly summary.',
          status: 'failed',
          errorCode: 'AI_PROVIDER_ERROR',
        },
        {
          question: 'Summarize all my meals.',
          status: 'cancelled',
          errorCode: 'CANCELLED',
        },
      ]);
      const counts = {
        activeEntries: await tx.entity.count({
          where: { userId: user.id, deletedAt: null },
        }),
        healthRecords: await tx.healthRecord.count({
          where: { userId: user.id },
        }),
        threads: await tx.chatThread.count({ where: { userId: user.id } }),
        messages: await tx.chatMessage.count({
          where: { thread: { userId: user.id } },
        }),
      };
      return {
        anchorDate,
        from,
        timezone: user.timezone,
        created,
        counts,
        model: { id: model.id, providerModelId: model.providerModelId },
        today: day(anchorDate).summary,
        weekly: weekly.summary,
        syntheticConversations: true,
      };
    },
    { maxWait: 10_000, timeout: 180_000 },
  );
  Object.assign(report, result, { committed: true });
} catch (error) {
  report.committed = false;
  report.error = {
    stage,
    classification: error?.code ?? error?.name ?? 'UnknownError',
  };
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  await writeFile(
    new URL('../docs/test-account-seed-verification.json', import.meta.url),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
}
