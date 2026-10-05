import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../dist/common/database/prisma-client.js';
import { localDate, shiftDate } from '../dist/common/time/calendar.js';

// Uses only the existing test account. Never print bearer tokens or raw errors.
const base = 'https://kimbo-backend.fly.dev';
const prisma = createPrismaClient(process.env.DATABASE_URL);
const report = { target: base, account: 'test@email.com', checks: [] };
let threadId;
let token;
const api = async (path, method = 'GET', body, status = 200) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(200_000),
  });
  assert.equal(response.status, status, `Unexpected HTTP status for ${path}`);
  if (status === 204) return;
  if (response.headers.get('content-type')?.includes('application/x-ndjson')) {
    return (await response.text()).trim().split('\n').map(JSON.parse);
  }
  return response.json();
};
try {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: report.account },
    select: { authProviderId: true, timezone: true },
  });
  token = user.authProviderId;
  assert.ok(token);
  await api('/health');
  const today = localDate(new Date(), user.timezone);
  await api(`/v1/home?date=${today}`);
  const models = await api('/v1/ai/models');
  assert.ok(models.length);
  const unauthorized = await fetch(`${base}/v1/chat/threads`, {
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(unauthorized.status, 401);
  await unauthorized.body.cancel();
  report.checks.push('Health, Home, model registry and bearer enforcement');
  await api('/v1/nutrition/search?q=banana&page=1&provider=usda-fdc');
  report.checks.push('USDA API key works through deployed nutrition search');

  const thread = await api(
    '/v1/chat/threads',
    'POST',
    {
      title: '[Verification] Fly deployment smoke test',
    },
    201,
  );
  threadId = thread.id;
  assert.equal((await api(`/v1/chat/threads/${threadId}`)).id, threadId);
  const firstPage = await api('/v1/chat/threads?limit=1');
  assert.equal(firstPage.length, 1);
  const nextPage = await api(
    `/v1/chat/threads?limit=1&cursor=${firstPage[0].id}`,
  );
  assert.ok(!nextPage.some((row) => row.id === firstPage[0].id));
  const body = {
    requestId: randomUUID(),
    content: [
      {
        type: 'text',
        text: `Use get_day_health for ${shiftDate(today, -1)} and summarize the saved nutrition in one sentence.`,
      },
    ],
  };
  const events = await api(
    `/v1/chat/threads/${threadId}/messages`,
    'POST',
    body,
  );
  assert.equal(events[0].type, 'message.started');
  assert.equal(events.at(-1).type, 'message.completed');
  assert.ok(
    events.some(
      (event) =>
        event.type === 'tool.completed' && event.tool === 'get_day_health',
    ),
  );
  const sources = events
    .filter((event) => event.type === 'source.added')
    .map((event) => event.source);
  assert.ok(
    sources.some(
      (source) => source.type === 'daily_health' && source.origin === 'tool',
    ),
  );
  const text = events
    .filter((event) => event.type === 'text.delta')
    .map((event) => event.delta)
    .join('');
  assert.ok(text.trim());
  const messages = await api(`/v1/chat/threads/${threadId}/messages`);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].message, text);
  assert.ok(messages[1].actualModelId);
  assert.deepEqual(messages[1].metadata.sources, sources);
  const replay = await api(
    `/v1/chat/threads/${threadId}/messages`,
    'POST',
    body,
  );
  assert.equal(replay[0].replayed, true);
  assert.equal(replay[0].messageId, events[0].messageId);
  assert.equal(
    replay
      .filter((event) => event.type === 'text.delta')
      .map((event) => event.delta)
      .join(''),
    text,
  );
  const older = await api(
    `/v1/chat/threads/${threadId}/messages?limit=1&before=${messages[1].sequenceNumber}`,
  );
  assert.equal(older[0].id, messages[0].id);
  await api(`/v1/chat/threads/${threadId}`, 'PATCH', {
    threadStatus: 'archived',
  });
  report.checks.push(
    'Thread CRUD/pagination, real OpenRouter retrieval, NDJSON, persisted sources/model and idempotent replay',
  );
  report.actualModelId = messages[1].actualModelId;
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error?.code ?? error?.name ?? 'UnknownError';
  process.exitCode = 1;
} finally {
  if (threadId) {
    try {
      await api(`/v1/chat/threads/${threadId}`, 'DELETE', undefined, 204);
      report.temporaryThreadDeleted = true;
    } catch {
      report.temporaryThreadDeleted = false;
      process.exitCode = 1;
    }
  }
  await prisma.$disconnect();
  console.log(JSON.stringify(report, null, 2));
}
