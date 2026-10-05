import { ConfigService } from '@nestjs/config';
import { vi } from 'vitest';
import { OpenRouterAiProvider } from './openrouter-ai.provider.js';
import { entryInput } from '../../entries/application/entry-input.js';
const entry = {
  ...entryInput(
    {
      category: 'note',
      entryDate: '2026-10-05',
      occurredAt: '2026-10-05T08:00:00Z',
      note: 'Feeling tired',
    },
    { userId: 'owner', timezone: 'UTC', development: true },
  ),
  id: 'entry',
  revision: 1,
  createdAt: '',
  updatedAt: '',
  summary: { caloriesKcal: null },
  ai: { status: 'pending' as const, synopsis: null },
};
const selected = {
  id: 'registered-model',
  name: 'Vision model',
  provider: 'openrouter',
  providerModelId: 'requested-model',
  supportsText: true,
  supportsImages: true,
  supportsAudio: false,
};
const actual = {
  ...selected,
  id: 'registered-actual',
  providerModelId: 'actual-model',
};
const models = {
  selectForEntry: vi.fn().mockResolvedValue(selected),
  findAllowed: vi.fn().mockResolvedValue(actual),
  list: vi.fn(),
};
const config = new ConfigService({
  OPENROUTER_API_KEY: 'test-secret',
});
afterEach(() => {
  vi.unstubAllGlobals();
  models.selectForEntry.mockResolvedValue(selected);
  models.findAllowed.mockResolvedValue(actual);
});
it('requests structured output and attributes the returned actual model', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        model: 'actual-model',
        choices: [
          {
            message: {
              content: JSON.stringify({
                synopsis: 'A note about tiredness.',
                observations: ['Reported tiredness'],
              }),
            },
          },
        ],
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal('fetch', fetcher);
  expect(
    await new OpenRouterAiProvider(config, models).analyse('owner', entry),
  ).toEqual({
    synopsis: 'A note about tiredness.',
    structured: { observations: ['Reported tiredness'] },
    providerModelId: 'actual-model',
    modelId: 'registered-actual',
  });
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
  const payload = JSON.parse(options.body);
  expect(payload).toMatchObject({
    model: 'requested-model',
    user: 'owner',
    response_format: { type: 'json_schema', json_schema: { strict: true } },
    provider: { require_parameters: true },
  });
  expect(payload.messages[1].content[0].text).toContain('Feeling tired');
  expect(payload.messages[1].content[0].text).not.toContain('test-secret');
});
it('rejects malformed model output instead of saving an invalid synopsis', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: '{"synopsis":123,"observations":[]}' } },
          ],
        }),
      ),
    ),
  );
  await expect(
    new OpenRouterAiProvider(config, models).analyse('owner', entry),
  ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
});
it('returns sanitized provider errors and does not expose the response body', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response('sensitive upstream error', { status: 429 }),
      ),
  );
  await expect(
    new OpenRouterAiProvider(config, models).analyse('owner', entry),
  ).rejects.toMatchObject({
    code: 'AI_RATE_LIMITED',
    message: 'AI_RATE_LIMITED',
  });
});

it('sends image bytes as Base64 data URLs and never uses a storage URL', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        model: 'actual-model',
        choices: [
          {
            message: {
              content: '{"synopsis":"An image note.","observations":[]}',
            },
          },
        ],
      }),
    ),
  );
  vi.stubGlobal('fetch', fetcher);
  await new OpenRouterAiProvider(config, models).analyse('owner', {
    ...entry,
    attachments: [
      {
        id: 'photo',
        type: 'image',
        base64: 'aW1hZ2U=',
        mimeType: 'image/png',
        fileSizeBytes: 5,
      },
    ],
  });
  const payload = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(payload.messages[1].content[1]).toEqual({
    type: 'image_url',
    image_url: { url: 'data:image/png;base64,aW1hZ2U=' },
  });
});
it('makes no external request when the model table has no eligible model', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  models.selectForEntry.mockResolvedValue(null);
  await expect(
    new OpenRouterAiProvider(config, models).analyse('owner', entry),
  ).rejects.toMatchObject({ code: 'AI_NO_ALLOWED_MODEL' });
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects an unregistered actual model returned by the provider', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'outside-table',
          choices: [
            { message: { content: '{"synopsis":"Note","observations":[]}' } },
          ],
        }),
      ),
    ),
  );
  models.findAllowed.mockResolvedValue(null);
  await expect(
    new OpenRouterAiProvider(config, models).analyse('owner', entry),
  ).rejects.toMatchObject({ code: 'AI_UNREGISTERED_MODEL' });
});

it.each([
  ['audio/wav', 'wav'],
  ['audio/mpeg', 'mp3'],
  ['audio/mp4', 'm4a'],
])(
  'sends %s as Base64 input_audio with %s format using an audio-capable table model',
  async (mimeType, format) => {
    const audioModel = { ...selected, supportsAudio: true };
    models.selectForEntry.mockResolvedValue(audioModel);
    models.findAllowed.mockResolvedValue({ ...actual, supportsAudio: true });
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'actual-model',
          choices: [
            {
              message: {
                content: '{"synopsis":"An audio note.","observations":[]}',
              },
            },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    await new OpenRouterAiProvider(config, models).analyse('owner', {
      ...entry,
      attachments: [
        {
          id: 'recording',
          type: 'audio',
          base64: 'UklGRg==',
          mimeType,
          fileSizeBytes: 4,
        },
      ],
    });
    expect(models.selectForEntry).toHaveBeenCalledWith('owner', true);
    const payload = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(payload.messages[1].content[1]).toEqual({
      type: 'input_audio',
      input_audio: { data: 'UklGRg==', format },
    });
  },
);
it('reports insufficient provider credits separately from invalid audio data', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response('provider credit restriction', { status: 402 }),
      ),
  );
  await expect(
    new OpenRouterAiProvider(config, models).analyse('owner', entry),
  ).rejects.toMatchObject({ code: 'AI_INSUFFICIENT_CREDITS' });
});
