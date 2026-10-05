import 'dotenv/config';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { PrismaService } from '../dist/common/database/prisma.service.js';

// Live availability probe, not a conversational correctness test. It uses only
// the existing test account and disables background entry analysis.
process.env.AI_WORKER_ENABLED = 'false';
process.env.DEV_AUTH_ENABLED = 'false';
const report = {
  account: 'test@email.com',
  checkedAt: new Date().toISOString(),
  scope:
    'Local compiled Nest server, live PostgreSQL, real account bearer authentication',
  requests: [],
};
let app;
try {
  app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const prisma = app.get(PrismaService).client;
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: report.account },
    select: {
      id: true,
      authProviderId: true,
      timezone: true,
      onboardingCompletedAt: true,
    },
  });
  if (!user.authProviderId) throw new Error('Test account has no bearer token');
  const [entries, records, threads, messages, latest] = await Promise.all([
    prisma.entity.count({ where: { userId: user.id, deletedAt: null } }),
    prisma.healthRecord.count({ where: { userId: user.id } }),
    prisma.chatThread.count({ where: { userId: user.id } }),
    prisma.chatMessage.count({ where: { thread: { userId: user.id } } }),
    prisma.entity.findFirst({
      where: { userId: user.id, deletedAt: null },
      orderBy: { entryDate: 'desc' },
      select: { entryDate: true },
    }),
  ]);
  report.data = {
    timezone: user.timezone,
    onboardingCompleted: Boolean(user.onboardingCompletedAt),
    activeEntries: entries,
    healthRecords: records,
    threads,
    messages,
    latestEntryDate: latest?.entryDate.toISOString().slice(0, 10) ?? null,
  };
  const fixtures = await prisma.chatMessage.findMany({
    where: { thread: { userId: user.id, title: { startsWith: '[Dummy]' } } },
    orderBy: [{ threadId: 'asc' }, { sequenceNumber: 'asc' }],
    select: {
      id: true,
      threadId: true,
      sequenceNumber: true,
      requestId: true,
      role: true,
      status: true,
      replyToMessageId: true,
      actualModelId: true,
      metadata: true,
    },
  });
  const fixtureEntities = new Map(
    (
      await prisma.entity.findMany({
        where: { userId: user.id, deletedAt: null },
        select: { entityId: true, revision: true },
      })
    ).map((e) => [e.entityId, e.revision]),
  );
  let sourceCount = 0;
  for (let i = 0; i < fixtures.length; i += 2) {
    const question = fixtures[i];
    const answer = fixtures[i + 1];
    assert.equal(question.role, 'user');
    assert.ok(answer, 'Fixture assistant row missing');
    assert.equal(answer.role, 'assistant');
    assert.equal(answer.threadId, question.threadId);
    assert.equal(answer.requestId, question.requestId);
    assert.equal(answer.replyToMessageId, question.id);
    assert.equal(answer.sequenceNumber, question.sequenceNumber + 1);
    assert.equal(
      answer.actualModelId,
      null,
      'Dummy replies must not claim an actual model',
    );
    assert.equal(answer.metadata.aiGenerated, false);
    for (const source of answer.metadata.sources ?? []) {
      assert.ok(source.snapshot && source.provenance);
      for (const entity of source.provenance.entities) {
        assert.equal(
          fixtureEntities.get(entity.entityId),
          entity.revision,
          'Seed source revision differs from saved entry',
        );
      }
      for (const id of source.provenance.healthRecordIds) {
        assert.ok(
          await prisma.healthRecord.findFirst({
            where: { id, userId: user.id },
          }),
        );
      }
      sourceCount++;
    }
  }
  report.fixtureChecks = {
    orderedRequestPairs: fixtures.length / 2,
    assistantStatuses: fixtures
      .filter((m) => m.role === 'assistant')
      .reduce(
        (counts, m) => ({ ...counts, [m.status]: (counts[m.status] ?? 0) + 1 }),
        {},
      ),
    sourceSnapshotsWithValidProvenance: sourceCount,
    realProviderCalls: 0,
  };
  const request = async (path, method = 'GET', body, authenticated = true) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(authenticated
          ? { Authorization: `Bearer ${user.authProviderId}` }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    });
    const contentType = response.headers.get('content-type');
    // This probe intentionally stops before sending messages when chat exists.
    const data = contentType?.includes('application/json')
      ? await response.json()
      : null;
    if (!data) await response.body?.cancel();
    report.requests.push({
      method,
      path,
      authenticated,
      status: response.status,
      contentType,
    });
    return { status: response.status, data };
  };
  await request('/health');
  const home = await request(
    `/v1/home${latest ? `?date=${report.data.latestEntryDate}` : ''}`,
  );
  report.homeAvailable = home.status === 200;
  const unauthorized = await request('/v1/home', 'GET', undefined, false);
  report.authenticationEnforced = unauthorized.status === 401;
  const models = await request('/v1/ai/models');
  report.availableModelCount = Array.isArray(models.data)
    ? models.data.length
    : null;
  if (latest) {
    const entries = await request(
      `/v1/entries?date=${report.data.latestEntryDate}`,
    );
    report.entriesAvailable =
      entries.status === 200 && Array.isArray(entries.data);
    report.entriesOnLatestDate = Array.isArray(entries.data)
      ? entries.data.length
      : null;
    report.homeSummary = home.status === 200 ? home.data.summary : null;
    if (home.status === 200 && report.entriesAvailable) {
      const nutrition = entries.data.filter(
        (entry) => entry.category === 'nutrition',
      );
      assert.equal(home.data.summary.nutrition.entryCount, nutrition.length);
      assert.ok(
        Math.abs(
          home.data.summary.nutrition.caloriesConsumedKcal -
            nutrition.reduce(
              (sum, entry) => sum + (entry.summary.caloriesKcal ?? 0),
              0,
            ),
        ) < 0.01,
      );
      report.homeMatchesSavedNutrition = true;
    }
  }
  const list = await request('/v1/chat/threads');
  report.chatRoutesAvailable = list.status === 200;
  // If the list route is missing, verify all proposed routes without creating
  // any database rows. Do not POST into an implemented chat subsystem here.
  if (list.status === 404) {
    const threadId = randomUUID();
    await request('/v1/chat/threads', 'POST', {});
    await request(`/v1/chat/threads/${threadId}`);
    await request(`/v1/chat/threads/${threadId}/messages`);
    await request(`/v1/chat/threads/${threadId}/messages`, 'POST', {
      requestId: randomUUID(),
      content: [{ type: 'text', text: 'How am I doing today?' }],
    });
    report.blocker =
      'All five proposed chat routes return 404; no chat module is registered in AppModule.';
    report.untested = [
      'Thread creation',
      'Message idempotency',
      'Agent retrieval',
      'Sources',
      'NDJSON streaming',
      'Provider failure/fallback',
      'Cancellation',
    ];
  }
  if (
    !report.homeAvailable ||
    !report.authenticationEnforced ||
    !report.chatRoutesAvailable
  )
    process.exitCode = 1;
} catch {
  report.error =
    'Live availability check could not finish; credentials and provider errors omitted.';
  process.exitCode = 1;
} finally {
  await app?.close();
  await writeFile(
    new URL('../docs/chat-live-verification.json', import.meta.url),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
}
