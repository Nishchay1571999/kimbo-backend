import { vi } from 'vitest';
import {
  HealthProjectionService,
  weekPeriod,
  monthPeriod,
  healthPeriod,
} from './health-projection.service.js';
import { GetHomeUseCase } from '../../home/application/get-home/get-home.use-case.js';
import { entryInput } from '../../entries/application/entry-input.js';
import type { Entry } from '../../entries/domain/entry.types.js';
const identity = {
  userId: 'owner',
  timezone: 'Asia/Kolkata',
  development: false,
};
const profile = {
  timezone: identity.timezone,
  wakeTime: '07:30',
  sleepTime: '23:30',
};
function meal(date: string, kcal: number): Entry {
  return {
    ...entryInput(
      {
        category: 'nutrition',
        title: 'Lunch',
        entryDate: date,
        occurredAt: `${date}T13:00:00+05:30`,
        data: {
          mealCategory: 'lunch',
          items: [
            { name: 'Rice', quantity: 1, unit: 'portion', caloriesKcal: kcal },
          ],
        },
      },
      identity,
    ),
    id: date,
    revision: 3,
    createdAt: '',
    updatedAt: '',
    summary: { caloriesKcal: kcal },
    ai: { status: 'not_requested', synopsis: null },
  };
}
const entries = [meal('2026-10-01', 1800), meal('2026-10-03', 1900)];
const repository = {
  create: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(async (_userId: string, date: string) =>
    entries.filter((entry) => entry.entryDate === date),
  ),
  listRange: vi.fn(async () => entries),
};
const profiles = { get: vi.fn(async () => profile) };
const targets = {
  get: vi.fn(async () => null),
  save: vi.fn(),
  suggestionInput: vi.fn(),
};
const service = new HealthProjectionService(
  repository,
  profiles,
  new GetHomeUseCase(repository, profiles, targets),
  targets,
);
beforeEach(() => vi.clearAllMocks());
it('fetches a range once and excludes missing nutrition days from averages', async () => {
  const result = await service.range('owner', '2026-10-01', '2026-10-03');
  expect(repository.listRange).toHaveBeenCalledExactlyOnceWith(
    'owner',
    '2026-10-01',
    '2026-10-03',
  );
  expect(repository.list).not.toHaveBeenCalled();
  expect(result.snapshot.summary).toMatchObject({
    daysInRange: 3,
    daysTracked: 2,
    daysWithNutrition: 2,
    caloriesConsumedKcal: 3700,
    averageCaloriesConsumedKcal: 1850,
    caloriesBurnedKcal: null,
  });
  expect(result.snapshot.days[1].tracked).toBe(false);
});
it('shares Home calculations and records revisions without attachments or AI proposals', async () => {
  const result = await service.day('owner', '2026-10-01');
  expect(result.snapshot.summary.nutrition.caloriesConsumedKcal).toBe(1800);
  expect(result.provenance.entities).toEqual([
    { entityId: '2026-10-01', revision: 3 },
  ]);
  expect(result.snapshot.entries[0]).not.toHaveProperty('attachments');
  expect(result.snapshot.entries[0]).not.toHaveProperty('ai');
});
it('flags entry truncation and scopes provenance to returned entries', async () => {
  const result = await service.getEntries(
    'owner',
    '2026-10-01',
    '2026-10-03',
    'nutrition',
    1,
  );
  expect(result.snapshot).toMatchObject({ total: 2, truncated: true });
  expect(result.provenance.entities).toHaveLength(1);
});
it('uses Monday weeks and leap-aware calendar months and bounds periods', () => {
  expect(weekPeriod('2026-10-04')).toEqual({
    from: '2026-09-28',
    to: '2026-10-04',
  });
  expect(weekPeriod('2026-10-05')).toEqual({
    from: '2026-10-05',
    to: '2026-10-11',
  });
  expect(monthPeriod('2024-02-15')).toEqual({
    from: '2024-02-01',
    to: '2024-02-29',
  });
  expect(() => healthPeriod('2026-10-03', '2026-10-01')).toThrow();
  expect(() => healthPeriod('2026-01-01', '2026-10-01')).toThrow();
});
