import { buildHome } from './get-home.use-case.js';
import { entryInput } from '../../../entries/application/entry-input.js';
import type { Entry } from '../../../entries/domain/entry.types.js';
const user = { userId: 'a', timezone: 'Asia/Kolkata', development: true };
function entry(raw: unknown): Entry {
  return {
    ...entryInput(raw, user),
    id: 'a',
    revision: 1,
    createdAt: '2026-10-05T00:00:00Z',
    updatedAt: '2026-10-05T00:00:00Z',
    summary: { caloriesKcal: 195 },
    ai: { status: 'pending', synopsis: null },
  };
}
const meal = entry({
  category: 'nutrition',
  entryDate: '2026-10-05',
  occurredAt: '2026-10-06T00:15:00+05:30',
  data: {
    mealCategory: 'dinner',
    items: [{ name: 'Rice', quantity: 150, unit: 'g', caloriesKcal: 195 }],
  },
});
const exercise = entry({
  category: 'exercise',
  entryDate: '2026-10-05',
  occurredAt: '2026-10-05T18:00:00+05:30',
  data: {
    activityName: 'Walking',
    durationMinutes: 30,
    estimatedCaloriesBurnedKcal: 300,
    calorieEstimationSource: 'user_entered',
  },
});
describe('Home reporting and timeline', () => {
  it('keeps consumed and burned calories separate and sleep on the next day', () => {
    const home = buildHome(
      '2026-10-05',
      { timezone: user.timezone, wakeTime: '07:00', sleepTime: '00:30' },
      [meal, exercise],
      new Date('2026-10-04T20:00:00Z'),
    );
    expect(home.day).toMatchObject({
      isToday: true,
      previous: '2026-10-04',
      next: '2026-10-06',
      weekday: 'Monday',
    });
    expect(home.summary).toEqual({
      nutrition: { caloriesConsumedKcal: 195, entryCount: 1 },
      exercise: { durationMinutes: 30, caloriesBurnedKcal: 300 },
    });
    expect(home.timeline.at(-1)).toEqual({
      type: 'boundary',
      boundary: 'sleep',
      date: '2026-10-06',
      time: '00:30',
    });
    expect(home.timeline[2]).toMatchObject({
      type: 'entry',
      date: '2026-10-06',
      time: '00:15',
      outsideSchedule: false,
      entry: meal,
    });
  });
  it('retains reporting-day entries outside schedule and marks them', () => {
    const beforeWake = { ...meal, occurredAt: '2026-10-05T01:00:00Z' };
    const home = buildHome(
      '2026-10-05',
      { timezone: user.timezone, wakeTime: '07:00', sleepTime: '00:30' },
      [beforeWake],
    );
    expect(home.timeline[0]).toMatchObject({
      type: 'entry',
      time: '06:30',
      outsideSchedule: true,
    });
    expect(home.summary.nutrition.caloriesConsumedKcal).toBe(195);
  });
  it('does not invent missing profile boundaries or unknown burned calories', () => {
    const home = buildHome(
      '2026-10-05',
      { timezone: 'UTC', wakeTime: null, sleepTime: null },
      [],
    );
    expect(home.timeline).toEqual([]);
    expect(home.summary.exercise.caloriesBurnedKcal).toBeNull();
    expect(home.sections.map((s) => s.type)).toEqual([
      'nutrition_summary',
      'exercise_summary',
      'timeline',
    ]);
  });
});
describe('GetHomeUseCase.week', () => {
  it('returns the 7 days ending on the date, capped at today, with net deltas', async () => {
    const { GetHomeUseCase } = await import('./get-home.use-case.js');
    const { localDate, shiftDate } =
      await import('../../../../common/time/calendar.js');
    const today = localDate(new Date(), 'UTC');
    const listRange = vi.fn().mockResolvedValue([
      { ...meal, entryDate: today },
      { ...exercise, entryDate: today },
    ]);
    const useCase = new GetHomeUseCase(
      { listRange } as never,
      {
        get: vi
          .fn()
          .mockResolvedValue({
            timezone: 'UTC',
            wakeTime: null,
            sleepTime: null,
          }),
      } as never,
      {
        get: vi.fn().mockResolvedValue({ caloriesKcal: 2000, proteinG: 100 }),
      } as never,
    );
    const week = await useCase.week('a', shiftDate(today, 30));
    expect(week.to).toBe(today);
    expect(week.from).toBe(shiftDate(today, -6));
    expect(listRange).toHaveBeenCalledWith('a', shiftDate(today, -6), today);
    expect(week.days.map((d) => d.date)).toEqual(
      Array.from({ length: 7 }, (_, i) => shiftDate(today, i - 6)),
    );
    expect(week.days[6]).toMatchObject({
      caloriesKcal: 195,
      deltaKcal: 195 - 300 - 2000,
    });
  });
});
