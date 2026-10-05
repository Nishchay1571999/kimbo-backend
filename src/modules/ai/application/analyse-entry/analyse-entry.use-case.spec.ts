import { vi } from 'vitest';
import { AnalyseEntryUseCase } from './analyse-entry.use-case.js';
import { AiProviderError } from '../../domain/ai-provider.js';
import type { AnalysisWork } from '../../domain/analysis-work.repository.js';
import { entryInput } from '../../../entries/application/entry-input.js';
const entry = {
  ...entryInput(
    {
      category: 'note',
      entryDate: '2026-10-05',
      occurredAt: '2026-10-05T08:00:00Z',
      note: 'Tired',
    },
    { userId: 'a', timezone: 'UTC', development: true },
  ),
  id: 'id',
  revision: 1,
  createdAt: '',
  updatedAt: '',
  summary: { caloriesKcal: null },
  ai: { status: 'pending' as const, synopsis: null },
};
const claim: AnalysisWork = {
  userId: 'a',
  entry,
  detailsId: 'd',
  revision: 1,
  attempt: 1,
  lockedUntil: new Date(),
};
it('passes claimed identity and revision through the independent AI workflow', async () => {
  const output = {
    synopsis: 'A note about tiredness.',
    structured: { observations: [] },
    providerModelId: 'model',
    modelId: 'registered-model',
  };
  const provider = { analyse: vi.fn().mockResolvedValue(output) };
  const work = {
    claim: vi.fn().mockResolvedValue(claim),
    complete: vi.fn().mockResolvedValue(false),
    fail: vi.fn(),
  };
  expect(await new AnalyseEntryUseCase(provider, work).execute()).toBe(true);
  expect(provider.analyse).toHaveBeenCalledWith('a', entry);
  expect(work.complete).toHaveBeenCalledWith('a', claim, output);
  expect(work.fail).not.toHaveBeenCalled();
});
it('saves a sanitized failure code for retries without exposing provider errors', async () => {
  const provider = {
    analyse: vi.fn().mockRejectedValue(new AiProviderError('AI_NETWORK_ERROR')),
  };
  const work = {
    claim: vi.fn().mockResolvedValue(claim),
    complete: vi.fn(),
    fail: vi.fn(),
  };
  await new AnalyseEntryUseCase(provider, work).execute();
  expect(work.fail).toHaveBeenCalledWith('a', claim, 'AI_NETWORK_ERROR');
});
