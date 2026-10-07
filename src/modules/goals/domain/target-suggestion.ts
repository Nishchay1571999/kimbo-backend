import {
  CALORIE_RANGE,
  PROTEIN_RANGE,
  type SuggestionInput,
} from './goal-target.js';
const ACTIVITY = { never: 1.2, once_or_twice: 1.375, four_to_five_plus: 1.55 };
const GOAL_ADJUSTMENT = { lose: -400, maintain: 0, gain: 300 };
const PROTEIN_PER_KG = { lose: 1.6, maintain: 1.2, gain: 1.6 };
const GOAL_LABEL = {
  lose: 'lose weight',
  maintain: 'maintain your weight',
  gain: 'gain weight',
};
const clamp = (value: number, { min, max }: { min: number; max: number }) =>
  Math.min(max, Math.max(min, value));
/** Mifflin-St Jeor resting energy × activity factor, adjusted for the goal. */
export function suggestTarget(input: SuggestionInput) {
  const sexOffset =
    input.gender === 'male' ? 5 : input.gender === 'female' ? -161 : -78;
  const bmr =
    10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age + sexOffset;
  const maintenance = bmr * ACTIVITY[input.exerciseFrequency];
  const caloriesKcal = clamp(
    Math.round((maintenance + GOAL_ADJUSTMENT[input.goalIntention]) / 50) * 50,
    CALORIE_RANGE,
  );
  const proteinG = clamp(
    Math.round((input.weightKg * PROTEIN_PER_KG[input.goalIntention]) / 5) * 5,
    PROTEIN_RANGE,
  );
  return {
    caloriesKcal,
    proteinG,
    explanation: `Based on your height, weight, age and activity, with a goal to ${GOAL_LABEL[input.goalIntention]}.`,
  };
}
