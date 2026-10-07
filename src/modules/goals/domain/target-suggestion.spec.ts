import { suggestTarget } from './target-suggestion.js';
const base = {
  heightCm: 175,
  weightKg: 80,
  age: 30,
  gender: 'male' as const,
  exerciseFrequency: 'once_or_twice' as const,
};
describe('suggestTarget', () => {
  it('applies Mifflin-St Jeor, activity and a deficit for weight loss', () => {
    // BMR 1748.75 × 1.375 = 2404.5 − 400 → 2000 (rounded to 50)
    expect(suggestTarget({ ...base, goalIntention: 'lose' })).toMatchObject({
      caloriesKcal: 2000,
      proteinG: 130,
    });
  });
  it('uses lower protein to maintain and a surplus to gain', () => {
    expect(suggestTarget({ ...base, goalIntention: 'maintain' })).toMatchObject(
      { caloriesKcal: 2400, proteinG: 95 },
    );
    expect(
      suggestTarget({ ...base, goalIntention: 'gain' }).caloriesKcal,
    ).toBe(2700);
  });
  it('clamps to the safe confirmed-target range', () => {
    const tiny = suggestTarget({
      heightCm: 140,
      weightKg: 35,
      age: 90,
      gender: 'female',
      goalIntention: 'lose',
      exerciseFrequency: 'never',
    });
    expect(tiny.caloriesKcal).toBe(1000);
    expect(tiny.proteinG).toBe(55);
  });
});
