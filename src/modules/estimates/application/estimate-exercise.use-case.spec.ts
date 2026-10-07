import { EstimateExerciseUseCase } from './estimate-exercise.use-case.js';
import { metCalories } from '../domain/met-table.js';
import type {
  EstimateRequest,
  ExtractedActivity,
} from '../domain/estimate.types.js';
const request: EstimateRequest = {
  category: 'exercise',
  title: 'Morning',
  note: '30 min run then 20 min yoga',
  image: { mimeType: 'image/jpeg', base64: 'AAAA' },
};
function setup(activities: ExtractedActivity[], weightKg: number | null) {
  const ai = {
    extractFoods: vi.fn(),
    pickFoods: vi.fn(),
    extractActivities: vi.fn().mockResolvedValue(activities),
  };
  return new EstimateExerciseUseCase(ai, {
    latestKg: vi.fn().mockResolvedValue(weightKg),
  });
}
describe('EstimateExerciseUseCase', () => {
  it('computes kcal = MET × kg × hours per activity', async () => {
    const result = await setup(
      [
        {
          activityName: 'Run',
          metKey: 'running_moderate',
          durationMinutes: 30,
          intensity: 'vigorous',
        },
        {
          activityName: 'Yoga',
          metKey: 'yoga',
          durationMinutes: 20,
          intensity: 'light',
        },
      ],
      70,
    ).execute('u', request);
    expect(result.activities.map((a) => [a.met, a.caloriesBurnedKcal])).toEqual(
      [
        [9.8, 343],
        [2.5, 58.33],
      ],
    );
    expect(result.totals).toEqual({
      durationMinutes: 50,
      caloriesBurnedKcal: 401.33,
    });
  });
  it('rejects notes without an activity', async () => {
    await expect(setup([], 70).execute('u', request)).rejects.toMatchObject({
      response: { code: 'ESTIMATE_NO_ACTIVITY_FOUND' },
    });
  });
  it('requires a body weight', async () => {
    await expect(
      setup(
        [
          {
            activityName: 'Walk',
            metKey: 'walking_brisk',
            durationMinutes: 10,
            intensity: 'moderate',
          },
        ],
        null,
      ).execute('u', request),
    ).rejects.toMatchObject({ response: { code: 'ESTIMATE_WEIGHT_REQUIRED' } });
  });
  it('metCalories handles fractional hours', () => {
    expect(metCalories(8, 60, 45)).toBe(360);
  });
});
