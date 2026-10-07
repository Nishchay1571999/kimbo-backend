import { buildDayGoal, dayStatus } from './day-goal.js';
import type { Entry } from '../../entries/domain/entry.types.js';
let id = 0;
function meal(
  mealCategory: 'breakfast' | 'lunch' | 'dinner' | 'snack',
  caloriesKcal: number,
  proteinG: number,
  entryDate = '2026-10-06',
): Entry {
  id += 1;
  return {
    id: `meal-${id}`,
    revision: 1,
    category: 'nutrition',
    title: mealCategory,
    entryDate,
    occurredAt: `${entryDate}T12:00:00Z`,
    recordedTimezone: 'UTC',
    inputSource: 'text',
    note: null,
    attachments: [],
    createdAt: '',
    updatedAt: '',
    data: {
      mealCategory,
      items: [
        {
          id: 'i',
          name: 'Food',
          quantity: 1,
          unit: 'serving',
          caloriesKcal,
          proteinG,
          carbohydratesG: null,
          fatG: null,
          quantitySource: 'user_entered',
          nutritionSource: 'user_entered',
        },
      ],
    },
    summary: { caloriesKcal },
    ai: { status: 'not_requested', synopsis: null },
  };
}
const target = { caloriesKcal: 2100, proteinG: 110 };
describe('dayStatus', () => {
  it('uses a ±10% band and keeps today in progress until the target is reached', () => {
    expect(dayStatus(0, 2100, false, false)).toBe('not_logged');
    expect(dayStatus(2000, 2100, true, false)).toBe('on_track');
    expect(dayStatus(2420, 2100, true, false)).toBe('over');
    expect(dayStatus(1200, 2100, true, false)).toBe('under');
    expect(dayStatus(1200, 2100, true, true)).toBe('in_progress');
  });
});
describe('buildDayGoal', () => {
  it('names the largest meal and compares it with recent habit when over', () => {
    const goal = buildDayGoal({
      target,
      isToday: false,
      localTime: '12:00',
      entries: [meal('breakfast', 500, 30), meal('lunch', 1200, 40), meal('dinner', 720, 40)],
      recentEntries: [meal('lunch', 900, 30, '2026-10-04'), meal('lunch', 1000, 30, '2026-10-05')],
    });
    expect(goal).toMatchObject({ status: 'over', deltaKcal: 320, remainingKcal: -320 });
    expect(goal.biggestMeal?.mealCategory).toBe('lunch');
    expect(goal.insight.headline).toBe(
      'Lunch was the largest contributor (1,200 kcal). It was ~250 kcal higher than your recent lunches.',
    );
  });
  it('flags low protein in the evening and suggests a concrete next meal', () => {
    const goal = buildDayGoal({
      target,
      isToday: true,
      localTime: '18:30',
      entries: [meal('breakfast', 600, 20), meal('lunch', 1020, 30)],
    });
    expect(goal).toMatchObject({ status: 'in_progress', remainingKcal: 480 });
    expect(goal.insight.headline).toBe("You're low on protein today (50 of 110 g).");
    expect(goal.insight.nextStep).toBe('Aim for ~40 g protein at dinner, staying around 480 kcal.');
  });
  it('suggests the next unlogged meal rather than one already eaten', () => {
    const goal = buildDayGoal({
      target,
      isToday: true,
      localTime: '09:30',
      entries: [meal('breakfast', 400, 30), meal('lunch', 600, 30)],
    });
    expect(goal.insight.nextStep).toBe('Aim for ~40 g protein at dinner, staying around 1,100 kcal.');
  });
  it('does not treat an unlogged day as zero intake', () => {
    const goal = buildDayGoal({ target, isToday: false, localTime: '12:00', entries: [] });
    expect(goal.status).toBe('not_logged');
    expect(goal.insight.headline).toBe('No meals were logged that day.');
  });
});
