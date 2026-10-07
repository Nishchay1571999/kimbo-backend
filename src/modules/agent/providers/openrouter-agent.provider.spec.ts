import { ConfigService } from '@nestjs/config';
import { vi } from 'vitest';
import type { AgentRequest } from '../domain/agent.types.js';
import { OpenRouterAgentProvider } from './openrouter-agent.provider.js';

const { callModel } = vi.hoisted(() => ({ callModel: vi.fn() }));
vi.mock('@openrouter/agent', () => ({
  OpenRouter: class {
    callModel = callModel;
  },
  stepCountIs: vi.fn(),
  maxCost: vi.fn(),
}));

const provider = new OpenRouterAgentProvider(
  new ConfigService({ OPENROUTER_API_KEY: 'test-secret' }),
);
const request = (): AgentRequest => ({
  instructions: 'Use recorded facts',
  messages: [{ role: 'user', content: 'Today?' }],
  models: ['primary', 'fallback'],
  tools: [],
  signal: new AbortController().signal,
  onText: vi.fn().mockResolvedValue(undefined),
});
const unavailable = Object.assign(new Error('private provider detail'), {
  statusCode: 404,
});
const result = (stream: () => AsyncGenerator<string>) => ({
  getTextStream: stream,
  getResponse: async () => ({ status: 'completed', model: 'fallback' }),
  getUsage: async () => ({ cost: 0.001 }),
  cancel: vi.fn().mockResolvedValue(undefined),
});
beforeEach(() => callModel.mockReset());

it('retries one registered fallback before progress using one explicit model per SDK call', async () => {
  const failed = result(async function* () {
    yield* [];
    throw unavailable;
  });
  callModel.mockReturnValueOnce(failed).mockReturnValueOnce(
    result(async function* () {
      yield 'Recorded today';
    }),
  );
  const input = request();
  expect((await provider.run(input)).providerModelId).toBe('fallback');
  expect(callModel.mock.calls.map(([args]) => args.model)).toEqual([
    'primary',
    'fallback',
  ]);
  expect(callModel.mock.calls.every(([args]) => !('models' in args))).toBe(
    true,
  );
  expect(callModel.mock.calls.every(([args]) => !('temperature' in args))).toBe(
    true,
  );
  expect(failed.cancel).toHaveBeenCalledOnce();
  expect(input.onText).toHaveBeenCalledExactlyOnceWith('Recorded today');
});

it('does not switch models after streamed text', async () => {
  callModel.mockReturnValue(
    result(async function* () {
      yield 'Partial';
      yield* [];
      throw unavailable;
    }),
  );
  await expect(provider.run(request())).rejects.toMatchObject({
    code: 'MODEL_UNAVAILABLE',
  });
  expect(callModel).toHaveBeenCalledOnce();
});

it('does not repeat retrieval after a tool lifecycle starts', async () => {
  callModel.mockImplementation((args) =>
    result(async function* () {
      args.hooks.PreToolUse[0].handler();
      yield* [];
      throw unavailable;
    }),
  );
  await expect(provider.run(request())).rejects.toMatchObject({
    code: 'MODEL_UNAVAILABLE',
  });
  expect(callModel).toHaveBeenCalledOnce();
});

it('preserves cancellation and does not try fallback', async () => {
  const controller = new AbortController();
  const reason = new Error('cancelled');
  callModel.mockReturnValue(
    result(async function* () {
      controller.abort(reason);
      yield* [];
      throw unavailable;
    }),
  );
  await expect(
    provider.run({ ...request(), signal: controller.signal }),
  ).rejects.toBe(reason);
  expect(callModel).toHaveBeenCalledOnce();
});
const unaffordable = (tokens: number) =>
  Object.assign(
    new Error(
      `This request requires more credits, or fewer max_tokens. You requested up to 1000 tokens, but can only afford ${tokens}.`,
    ),
    { statusCode: 402 },
  );
it('retries the same model within the key budget when max_tokens is unaffordable', async () => {
  callModel
    .mockReturnValueOnce(
      result(async function* () {
        yield* [];
        throw unaffordable(816);
      }),
    )
    .mockReturnValueOnce(
      result(async function* () {
        yield 'Within budget';
      }),
    );
  await provider.run(request());
  expect(
    callModel.mock.calls.map(([args]) => [args.model, args.maxOutputTokens]),
  ).toEqual([
    ['primary', 1000],
    ['primary', 800],
  ]);
});
it('reports insufficient credits when even a small reply is unaffordable', async () => {
  callModel.mockReturnValue(
    result(async function* () {
      yield* [];
      throw unaffordable(120);
    }),
  );
  await expect(provider.run(request())).rejects.toMatchObject({
    code: 'AI_INSUFFICIENT_CREDITS',
  });
  expect(callModel).toHaveBeenCalledOnce();
});
