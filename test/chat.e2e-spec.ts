import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { vi } from 'vitest';
import { isRegularExecuteTool } from '@openrouter/agent';
import { z } from 'zod';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/common/database/prisma.service.js';
import { ChatRepository } from '../src/modules/chat/infrastructure/chat.repository.js';
import {
  AGENT_PROVIDER,
  AgentError,
} from '../src/modules/agent/domain/agent.types.js';
import type { AgentRequest } from '../src/modules/agent/domain/agent.types.js';
import { AI_MODEL_REPOSITORY } from '../src/modules/ai/domain/ai-model.repository.js';
import { HealthProjectionService } from '../src/modules/health/application/health-projection.service.js';
import { HealthHistoryRepository } from '../src/modules/health/infrastructure/health-history.repository.js';
import type {
  ChatMessage,
  ChatThread,
} from '../src/generated/prisma/client.js';

const userId = 'd03a3426-20ab-4fc1-929f-7a6e471055f7';
const otherId = '47b23d84-7d2c-4e40-a25f-269f26141420';
const threadId = '435c84c5-596f-431e-bd16-86be149127af';
const modelId = 'a5ac077f-eeb3-4d67-8c5b-c00ca15d01a5';
const fallbackId = '57bba0ee-6710-47ba-a54c-2d928904e63d';
const requestId = '3d9a1f38-cddf-4b67-afd7-37838c423a0d';
const now = new Date('2026-10-05T12:00:00Z');
const model = {
  id: modelId,
  name: 'Registered primary',
  provider: 'openrouter',
  providerModelId: 'primary',
  supportsText: true,
  supportsImages: true,
  supportsAudio: false,
};
const fallback = { ...model, id: fallbackId, providerModelId: 'fallback' };
function thread(): ChatThread {
  return {
    id: threadId,
    userId,
    aiModelId: modelId,
    title: 'Test account chat',
    threadStatus: 'active',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}
function pair(): ChatMessage[] {
  const base = {
    threadId,
    requestId,
    message: '',
    replyToMessageId: null,
    actualModelId: null,
    metadata: {},
    errorCode: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  return [
    {
      ...base,
      id: '1f60f7fa-79a9-408f-8015-df97066fcb8c',
      role: 'user',
      status: 'completed',
      message: 'Show yesterday',
      sequenceNumber: 1,
      completedAt: now,
    },
    {
      ...base,
      id: '3e59000e-cf03-49db-a3d8-d5b73583d629',
      role: 'assistant',
      status: 'processing',
      sequenceNumber: 2,
      replyToMessageId: '1f60f7fa-79a9-408f-8015-df97066fcb8c',
    },
  ];
}
describe('Chat HTTP and agent orchestration (isolated test-account fixtures)', () => {
  let app: INestApplication;
  let current: ChatThread;
  let rows: ChatMessage[];
  const provider =
    vi.fn<
      (
        ...args: [AgentRequest]
      ) => Promise<{ providerModelId: string; usage: unknown }>
    >();
  const day = vi.fn(async (_userId: string, date: string) => ({
    modelData: {
      date,
      summary: { nutrition: { caloriesConsumedKcal: 520, entryCount: 1 } },
    },
    snapshot: { date, nutrition: { caloriesConsumedKcal: 520 } },
    provenance: {
      entities: [{ entityId: 'meal', revision: 2 }],
      healthRecordIds: [],
    },
  }));
  const owned = (owner: string, id: string) => {
    if (owner !== userId || id !== current.id || current.deletedAt)
      throw new NotFoundException('Thread not found');
    return current;
  };
  const chats = {
    create: vi.fn(async () => current),
    list: vi.fn(async () => [current]),
    get: vi.fn(async (owner: string, id: string) => owned(owner, id)),
    messages: vi.fn(async (owner: string, id: string) => {
      owned(owner, id);
      return rows;
    }),
    conversation: vi.fn(async () => [
      { role: 'assistant' as const, content: 'Earlier answer' },
    ]),
    begin: vi.fn(
      async (owner: string, id: string, requested: string, message: string) => {
        owned(owner, id);
        if (requested !== requestId || message !== rows[0].message)
          throw new ConflictException('REQUEST_ID_REUSED');
        return {
          thread: current,
          userMessage: rows[0],
          assistant: rows[1],
          replayed: rows[1].status !== 'processing',
        };
      },
    ),
    finish: vi.fn(async (_id: string, input: Partial<ChatMessage>) => {
      rows[1] = { ...rows[1], ...JSON.parse(JSON.stringify(input)) };
    }),
  };
  beforeEach(async () => {
    vi.clearAllMocks();
    current = thread();
    rows = pair();
    day.mockImplementation(async (_owner, date) => ({
      modelData: {
        date,
        summary: { nutrition: { caloriesConsumedKcal: 520, entryCount: 1 } },
      },
      snapshot: { date, nutrition: { caloriesConsumedKcal: 520 } },
      provenance: {
        entities: [{ entityId: 'meal', revision: 2 }],
        healthRecordIds: [],
      },
    }));
    provider.mockImplementation(async (input) => {
      await input.onText('Recorded ');
      await input.onText('520 kcal.');
      return { providerModelId: 'primary', usage: { inputTokens: 10 } };
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          AI_WORKER_ENABLED: 'false',
          DEV_AUTH_ENABLED: 'false',
          CHAT_FALLBACK_MODEL: 'fallback',
        }),
      )
      .overrideProvider(PrismaService)
      .useValue({
        client: {
          user: {
            findUnique: async (input: {
              where: { authProviderId: string };
            }) => ({
              id:
                input.where.authProviderId === 'test-account-token'
                  ? userId
                  : otherId,
              timezone: 'UTC',
              onboardingCompletedAt: now,
            }),
          },
        },
      })
      .overrideProvider(ChatRepository)
      .useValue(chats)
      .overrideProvider(AI_MODEL_REPOSITORY)
      .useValue({
        findForChat: async (id: string) =>
          [model, fallback].find(
            (item) => item.id === id || item.providerModelId === id,
          ) ?? null,
      })
      .overrideProvider(HealthProjectionService)
      .useValue({ day })
      .overrideProvider(HealthHistoryRepository)
      .useValue({
        profile: async () => ({
          timezone: 'UTC',
          profile: null,
          schedule: { wake: null, sleep: null },
          currentWeight: {
            recordId: 'weight',
            valueKg: 74.2,
            occurredAt: now.toISOString(),
          },
        }),
      })
      .overrideProvider(AGENT_PROVIDER)
      .useValue({ run: provider })
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
  });
  const send = () =>
    request(app.getHttpServer())
      .post(`/v1/chat/threads/${threadId}/messages`)
      .set('Authorization', 'Bearer test-account-token')
      .send({ requestId, content: [{ type: 'text', text: 'Show yesterday' }] });
  it('streams text and server sources and saves actual attribution before completion', async () => {
    const response = await send()
      .expect(200)
      .expect('Content-Type', /application\/x-ndjson/);
    const events = response.text
      .trim()
      .split('\n')
      .map((line: string) => JSON.parse(line));
    expect(events[0].type).toBe('message.started');
    expect(events.at(-1)).toMatchObject({
      type: 'message.completed',
      actualModelId: modelId,
    });
    expect(rows[1]).toMatchObject({
      message: 'Recorded 520 kcal.',
      status: 'completed',
      actualModelId: modelId,
    });
    expect(chats.finish).toHaveBeenCalledOnce();
    expect(events.filter((e) => e.type === 'source.added')).toHaveLength(2);
    const sent = provider.mock.calls[0][0];
    expect(sent.models).toEqual(['primary', 'fallback']);
    expect(sent.messages).toEqual([
      { role: 'assistant', content: 'Earlier answer' },
      { role: 'user', content: 'Show yesterday' },
    ]);
    expect(sent.instructions).toContain('74.2');
    for (const tool of sent.tools) {
      if (isRegularExecuteTool(tool))
        expect(
          z.safeParse(tool.function.inputSchema, { userId: otherId }).success,
        ).toBe(false);
    }
  });
  it('executes health retrieval with the bound test identity and preserves revisions', async () => {
    provider.mockImplementation(async (input) => {
      const tool = input.tools.find(
        (item) =>
          isRegularExecuteTool(item) && item.function.name === 'get_day_health',
      );
      if (!tool || !isRegularExecuteTool(tool)) throw new Error('Tool missing');
      await tool.function.execute({ date: '2026-10-04' });
      await input.onText('Yesterday: 520 kcal.');
      return { providerModelId: 'primary', usage: {} };
    });
    const response = await send().expect(200);
    expect(day).toHaveBeenCalledWith(userId, '2026-10-04');
    expect(response.text).toContain('tool.started');
    expect(response.text).toContain('tool.completed');
    const metadata = rows[1].metadata as {
      sources: { provenance: { entities: { revision: number }[] } }[];
    };
    expect(metadata.sources.at(-1)?.provenance.entities[0].revision).toBe(2);
  });
  it('attributes a registered fallback while retaining the selected thread model', async () => {
    provider.mockImplementation(async (input) => {
      await input.onText('Fallback answer.');
      return { providerModelId: 'fallback', usage: {} };
    });
    await send().expect(200);
    expect(rows[1].actualModelId).toBe(fallbackId);
    expect(current.aiModelId).toBe(modelId);
  });
  it('replays a completed result without another provider call', async () => {
    await send().expect(200);
    const response = await send().expect(200);
    expect(provider).toHaveBeenCalledOnce();
    expect(response.text).toContain('"replayed":true');
  });
  it('persists classified provider failure and excludes raw error details', async () => {
    provider.mockRejectedValue(new Error('secret provider details'));
    const response = await send().expect(200);
    expect(response.text).toContain('message.failed');
    expect(response.text).not.toContain('secret');
    expect(rows[1]).toMatchObject({
      status: 'failed',
      errorCode: 'AI_PROVIDER_ERROR',
    });
  });
  it('continues with an explicit tool failure and no fabricated retrieval source', async () => {
    day.mockImplementation(async (_owner, date) => {
      if (date === '2026-10-04') throw new Error('Database unavailable');
      return {
        modelData: {
          date,
          summary: { nutrition: { caloriesConsumedKcal: 520, entryCount: 1 } },
        },
        snapshot: { date, nutrition: { caloriesConsumedKcal: 520 } },
        provenance: {
          entities: [{ entityId: 'meal', revision: 2 }],
          healthRecordIds: [],
        },
      };
    });
    provider.mockImplementation(async (input) => {
      const tool = input.tools.find(
        (item) =>
          isRegularExecuteTool(item) && item.function.name === 'get_day_health',
      );
      if (!tool || !isRegularExecuteTool(tool)) throw new Error('Tool missing');
      expect(await tool.function.execute({ date: '2026-10-04' })).toMatchObject(
        { error: 'TOOL_FAILURE' },
      );
      await input.onText('Yesterday’s history is unavailable.');
      return { providerModelId: 'primary', usage: {} };
    });
    const response = await send().expect(200);
    expect(response.text).toContain('tool.failed');
    expect((rows[1].metadata as { sources: unknown[] }).sources).toHaveLength(
      2,
    );
  });
  it('persists cancellation classification', async () => {
    provider.mockRejectedValue(new AgentError('CANCELLED'));
    const response = await send().expect(200);
    expect(response.text).toContain('message.cancelled');
    expect(rows[1].status).toBe('cancelled');
  });
  it('rejects unauthenticated and cross-user access before running the provider', async () => {
    await request(app.getHttpServer()).get('/v1/chat/threads').expect(401);
    await request(app.getHttpServer())
      .get(`/v1/chat/threads/${threadId}`)
      .set('Authorization', 'Bearer isolated-other-token')
      .expect(404);
    await request(app.getHttpServer())
      .post(`/v1/chat/threads/${threadId}/messages`)
      .set('Authorization', 'Bearer isolated-other-token')
      .send({ requestId, content: [{ type: 'text', text: 'Show yesterday' }] })
      .expect(404);
    expect(provider).not.toHaveBeenCalled();
  });
});
