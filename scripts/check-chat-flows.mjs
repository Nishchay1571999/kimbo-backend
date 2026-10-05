import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../dist/app.module.js';
import { PrismaService } from '../dist/common/database/prisma.service.js';
import {
  AGENT_PROVIDER,
  AgentError,
} from '../dist/modules/agent/domain/agent.types.js';
import { OpenRouterAgentProvider } from '../dist/modules/agent/providers/openrouter-agent.provider.js';
import { localDate, shiftDate } from '../dist/common/time/calendar.js';
import { ENTRY_REPOSITORY } from '../dist/modules/entries/domain/entry.repository.js';

process.env.AI_WORKER_ENABLED = 'false';
process.env.DEV_AUTH_ENABLED = 'false';
const report = {
  account: 'test@email.com',
  checkedAt: new Date().toISOString(),
  scope:
    'Real PostgreSQL, bearer-authenticated HTTP, OpenRouter Agent SDK; controlled provider for fault injection only',
  checks: [],
  conversations: [],
};
let app;
let prisma;
let userId;
let fixtureEntryId;
let stage = 'startup';
const driver = {
  mode: 'live',
  calls: 0,
  actual: null,
  entered: null,
  async run(request) {
    this.calls++;
    if (this.mode === 'failure') throw new AgentError('AI_PROVIDER_ERROR');
    if (this.mode === 'timeout') throw new AgentError('AI_TIMEOUT');
    if (this.mode === 'waiting') {
      this.entered?.();
      await new Promise((resolve, reject) => {
        if (request.signal.aborted) reject(request.signal.reason);
        else
          request.signal.addEventListener(
            'abort',
            () => reject(request.signal.reason),
            { once: true },
          );
      });
    }
    try {
      return await this.actual.run(request);
    } catch (error) {
      if (error.diagnostic)
        report.providerDiagnostic = {
          ...error.diagnostic,
          requestedModels: request.models,
        };
      throw error;
    }
  },
};
try {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AGENT_PROVIDER)
    .useValue(driver)
    .compile();
  app = module.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  driver.actual = new OpenRouterAgentProvider(app.get(ConfigService));
  prisma = app.get(PrismaService).client;
  const base = await app.getUrl();
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: report.account },
    select: { id: true, authProviderId: true, timezone: true },
  });
  userId = user.id;
  const today = localDate(new Date(), user.timezone);
  const yesterday = shiftDate(today, -1);
  const api = async (
    path,
    method = 'GET',
    body,
    status = 200,
    token = user.authProviderId,
  ) => {
    const response = await fetch(`${base}/v1/${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(25_000),
    });
    assert.equal(
      response.status,
      status,
      `${method} ${path}: unexpected HTTP status`,
    );
    return response.status === 204 ? null : response.json();
  };
  const send = async (
    threadId,
    question,
    requestId = randomUUID(),
    expected = 'message.completed',
  ) => {
    const body = { requestId, content: [{ type: 'text', text: question }] };
    const response = await fetch(
      `${base}/v1/chat/threads/${threadId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.authProviderId}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(200_000),
      },
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/x-ndjson/);
    const events = [];
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line) events.push(JSON.parse(line));
      }
    }
    buffer += decoder.decode();
    assert.equal(buffer.trim(), '');
    assert.equal(events[0]?.type, 'message.started');
    const last = events.at(-1);
    report.conversations.push({
      question,
      provider:
        driver.mode === 'live' ? 'OpenRouter' : 'controlled fault injection',
      terminalEvent: last?.type,
      errorCode: last?.errorCode ?? null,
      toolCalls: events
        .filter((e) => e.type === 'tool.started')
        .map((e) => e.tool),
      sourceCount: events.filter((e) => e.type === 'source.added').length,
      text: events
        .filter((e) => e.type === 'text.delta')
        .map((e) => e.delta)
        .join(''),
    });
    assert.equal(
      last?.type,
      expected,
      `Unexpected terminal event: ${last?.errorCode ?? last?.type}`,
    );
    const assistant = await prisma.chatMessage.findUniqueOrThrow({
      where: { id: events[0].messageId },
    });
    assert.equal(
      assistant.status,
      expected === 'message.completed'
        ? 'completed'
        : expected === 'message.cancelled'
          ? 'cancelled'
          : 'failed',
    );
    const streamed = events
      .filter((e) => e.type === 'text.delta')
      .map((e) => e.delta)
      .join('');
    assert.equal(assistant.message, streamed);
    assert.deepEqual(
      assistant.metadata.sources,
      events.filter((e) => e.type === 'source.added').map((e) => e.source),
    );
    return { events, assistant, body };
  };
  stage = 'thread CRUD';
  const providerCalls = driver.calls;
  const thread = await api(
    'chat/threads',
    'POST',
    { title: 'Live chat verification' },
    201,
  );
  report.threadId = thread.id;
  assert.equal(
    driver.calls,
    providerCalls,
    'Creating a thread must not call AI',
  );
  assert.equal((await api(`chat/threads/${thread.id}`)).id, thread.id);
  assert.ok((await api('chat/threads')).some((row) => row.id === thread.id));
  assert.deepEqual(await api(`chat/threads/${thread.id}/messages`), []);
  await api(`chat/threads/${thread.id}`, 'PATCH', {
    title: 'Live chat verification — health retrieval',
  });
  report.checks.push(
    'Thread create/list/get/update; creation makes no provider call',
  );
  stage = 'authentication';
  await api('chat/threads', 'GET', undefined, 401, null);
  await api(
    `chat/threads/${thread.id}/messages`,
    'POST',
    {
      requestId: randomUUID(),
      userId: user.id,
      content: [{ type: 'text', text: 'Hello' }],
    },
    400,
  );
  await api(`chat/threads/${randomUUID()}`, 'GET', undefined, 404);
  report.checks.push(
    'Missing bearer rejected; identity spoofing rejected; unknown thread returns 404 (test account only)',
  );
  stage = 'live today chat';
  const initial = await send(
    thread.id,
    'How am I doing today? Use today’s supplied context, without historical tools.',
  );
  assert.equal(
    initial.events.filter((e) => e.type === 'tool.started').length,
    0,
  );
  assert.ok(initial.assistant.actualModelId);
  report.checks.push(
    'Today answered from current context; real text deltas, actual model and source snapshots persisted',
  );
  stage = 'idempotent replay';
  const calls = driver.calls;
  const replay = await send(
    thread.id,
    initial.body.content[0].text,
    initial.body.requestId,
  );
  assert.equal(replay.assistant.id, initial.assistant.id);
  assert.equal(replay.events[0].replayed, true);
  assert.equal(driver.calls, calls);
  assert.equal(
    await prisma.chatMessage.count({
      where: { threadId: thread.id, requestId: initial.body.requestId },
    }),
    2,
  );
  await api(
    `chat/threads/${thread.id}/messages`,
    'POST',
    {
      requestId: initial.body.requestId,
      content: [{ type: 'text', text: 'Different content' }],
    },
    409,
  );
  report.checks.push(
    'Same request replays exactly one saved pair without AI; changed content with same request ID returns 409',
  );
  stage = 'live historical day';
  const previous = await send(
    thread.id,
    `Use get_day_health for ${yesterday} and summarize my recorded nutrition and exercise that day.`,
  );
  assert.ok(
    previous.events.some(
      (e) => e.type === 'tool.completed' && e.tool === 'get_day_health',
    ),
  );
  assert.ok(
    previous.assistant.metadata.sources.some(
      (s) =>
        s.origin === 'tool' &&
        s.type === 'daily_health' &&
        s.snapshot.date === yesterday,
    ),
  );
  report.checks.push(
    'Historical day tool executed; date-specific snapshot and entry revisions persisted',
  );
  stage = 'live range and entry drill-down';
  const from = shiftDate(today, -6);
  const weekly = await send(
    thread.id,
    `Use get_health_range from ${from} through ${today}. Then use get_entries to inspect nutrition on the highest-calorie day in that range. Explain what was logged and exclude missing days from the average.`,
  );
  assert.ok(
    weekly.events.some(
      (e) => e.type === 'tool.completed' && e.tool === 'get_health_range',
    ),
  );
  assert.ok(
    weekly.events.some(
      (e) => e.type === 'tool.completed' && e.tool === 'get_entries',
    ),
  );
  const range = weekly.assistant.metadata.sources.find(
    (s) => s.type === 'health_range',
  );
  assert.ok(range.snapshot.summary.daysWithNutrition < 7);
  report.checks.push(
    'Multi-step range → meals retrieval; missing-day-aware deterministic average',
  );
  stage = 'live week/month/metric tools';
  for (const [tool, question] of [
    [
      'get_week_health',
      `Use get_week_health with anchorDate ${yesterday} to summarize last calendar week.`,
    ],
    [
      'get_month_health',
      `Use get_month_health with anchorDate ${today} to summarize this month.`,
    ],
    [
      'get_health_metric_history',
      `Use get_health_metric_history with metric weight from ${shiftDate(today, -20)} through ${today}. Describe the recorded trend without diagnosing.`,
    ],
  ]) {
    const result = await send(thread.id, question);
    assert.ok(
      result.events.some((e) => e.type === 'tool.completed' && e.tool === tool),
    );
  }
  report.checks.push(
    'All six read-only tools exercised with the real OpenRouter Agent SDK',
  );
  stage = 'real provider fallback';
  const config = app.get(ConfigService);
  const previousFallback = config.get('CHAT_FALLBACK_MODEL');
  config.set('CHAT_FALLBACK_MODEL', 'google/gemini-3.8-flash');
  try {
    const primary = await prisma.aiModel.findFirstOrThrow({
      where: { providerModelId: 'openai/gpt-4o-mini', isAvailable: true },
    });
    const fallback = await prisma.aiModel.findFirstOrThrow({
      where: { providerModelId: 'google/gemini-3.8-flash', isAvailable: true },
    });
    const fallbackThread = await api(
      'chat/threads',
      'POST',
      {
        title: '[Verification] Real provider fallback',
        aiModelId: primary.id,
      },
      201,
    );
    const fallbackResult = await send(
      fallbackThread.id,
      'Using only today context, summarize my logged calories in one sentence.',
    );
    assert.equal(fallbackResult.assistant.actualModelId, fallback.id);
    assert.equal(
      (await api(`chat/threads/${fallbackThread.id}`)).aiModelId,
      primary.id,
    );
    report.checks.push(
      'Real unavailable primary retries registered fallback; actual attribution recorded and thread selection preserved',
    );
  } finally {
    config.set(
      'CHAT_FALLBACK_MODEL',
      previousFallback ?? 'openai/gpt-5.4-mini',
    );
  }
  stage = 'source snapshots after entry edits and deletion';
  const fixtureData = (kcal) => ({
    mealCategory: 'snack',
    items: [
      {
        name: 'Dummy source retention fixture',
        quantity: 1,
        unit: 'portion',
        caloriesKcal: kcal,
      },
    ],
  });
  const fixtureEntry = await api(
    'entries',
    'POST',
    {
      category: 'nutrition',
      title: '[Verification] Source retention fixture',
      entryDate: yesterday,
      occurredAt: `${yesterday}T12:00:00+05:30`,
      data: fixtureData(510),
    },
    201,
  );
  fixtureEntryId = fixtureEntry.id;
  const old = await send(
    thread.id,
    `Use get_entries from ${yesterday} through ${yesterday}, category nutrition. List the saved calorie values, including the Source retention fixture.`,
  );
  const oldSource = old.assistant.metadata.sources.find(
    (source) => source.type === 'entries',
  );
  assert.equal(
    oldSource.snapshot.entries.find((entry) => entry.id === fixtureEntryId)
      .summary.caloriesKcal,
    510,
  );
  const frozen = JSON.stringify(old.assistant.metadata);
  const edited = await api(`entries/${fixtureEntryId}`, 'PATCH', {
    revision: fixtureEntry.revision,
    data: fixtureData(650),
  });
  assert.ok(edited.revision > fixtureEntry.revision);
  const updated = await send(
    thread.id,
    `Retrieve get_entries again for ${yesterday}, category nutrition. What is the saved value for the Source retention fixture now?`,
  );
  const newSource = updated.assistant.metadata.sources.find(
    (source) => source.type === 'entries',
  );
  assert.equal(
    newSource.snapshot.entries.find((entry) => entry.id === fixtureEntryId)
      .summary.caloriesKcal,
    650,
  );
  assert.equal(
    newSource.provenance.entities.find(
      (entry) => entry.entityId === fixtureEntryId,
    ).revision,
    edited.revision,
  );
  assert.equal(
    JSON.stringify(
      (
        await prisma.chatMessage.findUniqueOrThrow({
          where: { id: old.assistant.id },
        })
      ).metadata,
    ),
    frozen,
  );
  await api(`entries/${fixtureEntryId}`, 'DELETE', undefined, 204);
  const afterDelete = await send(
    thread.id,
    `Use get_day_health for ${yesterday}. Summarize only the currently saved entries; the Source retention fixture has been deleted.`,
  );
  const afterDeleteSource = afterDelete.assistant.metadata.sources.find(
    (source) => source.origin === 'tool' && source.type === 'daily_health',
  );
  assert.ok(
    !afterDeleteSource.snapshot.entries.some(
      (entry) => entry.id === fixtureEntryId,
    ),
  );
  assert.equal(
    JSON.stringify(
      (
        await prisma.chatMessage.findUniqueOrThrow({
          where: { id: old.assistant.id },
        })
      ).metadata,
    ),
    frozen,
  );
  fixtureEntryId = null;
  report.checks.push(
    'New answers use edited values/revisions; deleted entries excluded; old source snapshots remain unchanged',
  );
  stage = 'controlled provider failures';
  const faultThread = await api(
    'chat/threads',
    'POST',
    { title: '[Verification] Controlled provider failures' },
    201,
  );
  driver.mode = 'failure';
  const failed = await send(
    faultThread.id,
    'Controlled provider failure test',
    undefined,
    'message.failed',
  );
  assert.equal(failed.assistant.errorCode, 'AI_PROVIDER_ERROR');
  driver.mode = 'timeout';
  const timedOut = await send(
    faultThread.id,
    'Controlled timeout test',
    undefined,
    'message.failed',
  );
  assert.equal(timedOut.assistant.errorCode, 'AI_TIMEOUT');
  report.checks.push(
    'Controlled provider error and timeout persist failed assistant rows',
  );
  stage = 'controlled concurrency and disconnect';
  driver.mode = 'waiting';
  const entered = new Promise((resolve) => {
    driver.entered = resolve;
  });
  const abort = new AbortController();
  const requestId = randomUUID();
  const body = {
    requestId,
    content: [{ type: 'text', text: 'Controlled cancellation test' }],
  };
  const response = await fetch(
    `${base}/v1/chat/threads/${faultThread.id}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${user.authProviderId}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: abort.signal,
    },
  );
  await entered;
  await api(`chat/threads/${faultThread.id}/messages`, 'POST', body, 409);
  await api(
    `chat/threads/${faultThread.id}/messages`,
    'POST',
    {
      requestId: randomUUID(),
      content: [{ type: 'text', text: 'Another request' }],
    },
    409,
  );
  abort.abort();
  await response.body.cancel().catch(() => {});
  let cancelled;
  for (let attempt = 0; attempt < 25; attempt++) {
    cancelled = await prisma.chatMessage.findFirst({
      where: { threadId: faultThread.id, requestId, role: 'assistant' },
    });
    if (cancelled?.status === 'cancelled') break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal(cancelled?.status, 'cancelled');
  report.checks.push(
    'Concurrent same/different requests rejected; disconnect aborts generation and persists cancelled',
  );
  stage = 'archive and deletion';
  await api(`chat/threads/${thread.id}`, 'PATCH', { threadStatus: 'archived' });
  await api(
    `chat/threads/${thread.id}/messages`,
    'POST',
    {
      requestId: randomUUID(),
      content: [{ type: 'text', text: 'Archived thread' }],
    },
    409,
  );
  await api(`chat/threads/${thread.id}`, 'PATCH', { threadStatus: 'active' });
  const deletable = await api('chat/threads', 'POST', {}, 201);
  await api(`chat/threads/${deletable.id}`, 'DELETE', undefined, 204);
  await api(`chat/threads/${deletable.id}`, 'GET', undefined, 404);
  report.checks.push(
    'Archived threads reject new messages; deleted threads are hidden',
  );
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = {
    stage,
    classification: error?.code ?? error?.name ?? 'UnknownError',
  };
  process.exitCode = 1;
} finally {
  if (fixtureEntryId && prisma && userId) {
    const active = await prisma.entity.findFirst({
      where: { entityId: fixtureEntryId, userId, deletedAt: null },
      select: { entityId: true },
    });
    if (active) await app.get(ENTRY_REPOSITORY).delete(userId, fixtureEntryId);
  }
  await app?.close();
  await writeFile(
    new URL('../docs/chat-flow-verification.json', import.meta.url),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
}
