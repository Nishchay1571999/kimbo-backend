import { roundToTwoDecimals } from '../../../common/math/round.js';
import type {
  Entry,
  ExerciseData,
  NutritionData,
} from '../../entries/domain/entry.types.js';
export type DayStatus =
  'on_track' | 'over' | 'under' | 'not_logged' | 'in_progress';
export interface DayGoal {
  target: { caloriesKcal: number; proteinG: number };
  consumed: { caloriesKcal: number; proteinG: number };
  burned: ExerciseBurn;
  /** consumed − burned. Exercise without an estimate counts as 0 (see burned.incomplete). */
  netKcal: number;
  /** target − net. Negative once the target is exceeded. */
  remainingKcal: number;
  remainingProteinG: number;
  /** net − target; positive means over. */
  deltaKcal: number;
  status: DayStatus;
  biggestMeal: {
    entryId: string;
    title: string;
    mealCategory: NutritionData['mealCategory'];
    caloriesKcal: number;
  } | null;
  insight: { headline: string; nextStep: string | null };
}
export interface DayGoalInput {
  target: { caloriesKcal: number; proteinG: number };
  entries: Entry[];
  isToday: boolean;
  /** Local HH:mm, used only for today's next-meal suggestion. */
  localTime: string;
  /** Previous days' entries, used to compare the biggest meal with habit. */
  recentEntries?: Entry[];
}
export interface ExerciseBurn {
  caloriesKcal: number;
  durationMinutes: number;
  /** True when some exercise that day has no calorie estimate. */
  incomplete: boolean;
}
/** Calories burned from a day's exercise entries; missing estimates count as 0. */
export function exerciseBurn(entries: Entry[]): ExerciseBurn {
  const exercises = entries
    .filter((e) => e.category === 'exercise')
    .map((e) => e.data as ExerciseData);
  return {
    caloriesKcal: roundToTwoDecimals(
      exercises.reduce(
        (sum, e) => sum + (e.estimatedCaloriesBurnedKcal ?? 0),
        0,
      ),
    ),
    durationMinutes: exercises.reduce((sum, e) => sum + e.durationMinutes, 0),
    incomplete: exercises.some((e) => e.estimatedCaloriesBurnedKcal === null),
  };
}
const TOLERANCE = 0.1;
const MEAL_LABEL: Record<NutritionData['mealCategory'], string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'A snack',
  other: 'One meal',
};
const MEAL_PLURAL: Record<NutritionData['mealCategory'], string> = {
  breakfast: 'breakfasts',
  lunch: 'lunches',
  dinner: 'dinners',
  snack: 'snacks',
  other: 'meals',
};
const kcal = (value: number) =>
  `${Math.round(Math.abs(value)).toLocaleString('en-US')} kcal`;
const protein = (entry: Entry) =>
  (entry.data as NutritionData).items.reduce(
    (sum, item) => sum + (item.proteinG ?? 0),
    0,
  );
const MAIN_MEALS = ['breakfast', 'lunch', 'dinner'] as const;
/** The next main meal by clock that has not been logged yet. */
function nextMeal(time: string, meals: Entry[]) {
  const hour = Number(time.slice(0, 2));
  const fromClock = hour < 11 ? 0 : hour < 16 ? 1 : hour < 21 ? 2 : 3;
  const logged = new Set(
    meals.map((e) => (e.data as NutritionData).mealCategory),
  );
  const lastLogged = Math.max(
    -1,
    ...MAIN_MEALS.map((m, i) => (logged.has(m) ? i : -1)),
  );
  return MAIN_MEALS[Math.max(fromClock, lastLogged + 1)] ?? 'your next snack';
}
export function dayStatus(
  consumedKcal: number,
  targetKcal: number,
  logged: boolean,
  isToday: boolean,
): DayStatus {
  if (!logged) return 'not_logged';
  const ratio = consumedKcal / targetKcal;
  if (ratio > 1 + TOLERANCE) return 'over';
  if (ratio >= 1 - TOLERANCE) return 'on_track';
  return isToday ? 'in_progress' : 'under';
}
/** Deterministic, rule-based reading of one day against a confirmed target. */
export function buildDayGoal(input: DayGoalInput): DayGoal {
  const { target, isToday } = input;
  const meals = input.entries.filter((e) => e.category === 'nutrition');
  const caloriesKcal = roundToTwoDecimals(
    meals.reduce((sum, e) => sum + (e.summary.caloriesKcal ?? 0), 0),
  );
  const proteinG = roundToTwoDecimals(
    meals.reduce((sum, e) => sum + protein(e), 0),
  );
  const burned = exerciseBurn(input.entries);
  const netKcal = roundToTwoDecimals(caloriesKcal - burned.caloriesKcal);
  const status = dayStatus(
    netKcal,
    target.caloriesKcal,
    meals.length > 0,
    isToday,
  );
  const remainingKcal = Math.round(target.caloriesKcal - netKcal);
  const remainingProteinG = Math.round(target.proteinG - proteinG);
  const biggest = meals.reduce<Entry | null>(
    (top, e) =>
      (e.summary.caloriesKcal ?? 0) > (top?.summary.caloriesKcal ?? -1)
        ? e
        : top,
    null,
  );
  const biggestMeal = biggest
    ? {
        entryId: biggest.id,
        title: biggest.title,
        mealCategory: (biggest.data as NutritionData).mealCategory,
        caloriesKcal: biggest.summary.caloriesKcal ?? 0,
      }
    : null;
  const proteinLow =
    proteinG < target.proteinG * 0.6 &&
    (!isToday || input.localTime >= '17:00');
  const day = isToday ? 'today' : 'that day';
  let headline: string;
  let nextStep: string | null;
  if (status === 'not_logged' && burned.caloriesKcal > 0) {
    headline = `You burned ~${kcal(burned.caloriesKcal)} from ${burned.durationMinutes} min of exercise${isToday ? '' : ' that day'}, but no meals are logged.`;
    nextStep = isToday
      ? `Log your meals — your budget is ${kcal(remainingKcal)} after exercise.`
      : null;
  } else if (status === 'not_logged') {
    headline = isToday
      ? 'Nothing logged yet today.'
      : 'No meals were logged that day.';
    nextStep = isToday ? "Log your first meal to see how today's going." : null;
  } else if (status === 'over') {
    const label = biggestMeal
      ? MEAL_LABEL[biggestMeal.mealCategory]
      : 'One meal';
    headline = `${label} was the largest contributor (${kcal(biggestMeal?.caloriesKcal ?? 0)}).`;
    const usual =
      biggestMeal &&
      typicalMeal(input.recentEntries ?? [], biggestMeal.mealCategory);
    if (
      biggestMeal &&
      usual !== null &&
      biggestMeal.caloriesKcal - usual > 200 &&
      biggestMeal.mealCategory !== 'other'
    )
      headline += ` It was ~${kcal(Math.round((biggestMeal.caloriesKcal - usual) / 50) * 50)} higher than your recent ${MEAL_PLURAL[biggestMeal.mealCategory]}.`;
    nextStep = isToday
      ? "Keep the rest of today light. If you're hungry, pick something high in protein and low in calories."
      : `Next time, try a smaller ${biggestMeal?.mealCategory === 'other' ? 'portion' : `${biggestMeal?.mealCategory ?? 'meal'} portion`} instead of cutting food across the whole day.`;
  } else if (proteinLow) {
    headline = `You're low on protein ${day} (${Math.round(proteinG)} of ${target.proteinG} g).`;
    nextStep =
      isToday && remainingKcal > 0
        ? `Aim for ~${Math.min(40, remainingProteinG)} g protein at ${nextMeal(input.localTime, meals)}, staying around ${kcal(remainingKcal)}.`
        : 'Add a protein source such as dal, eggs, paneer, curd or chicken to your main meals.';
  } else if (status === 'under') {
    headline = `Logged intake was ${kcal(remainingKcal)} below your target.`;
    nextStep =
      'If some meals were not logged, add them to get a clearer picture.';
  } else {
    const proteinBehind =
      proteinG / target.proteinG < caloriesKcal / target.caloriesKcal - 0.1;
    headline = !isToday
      ? 'This day landed close to your target.'
      : status === 'on_track'
        ? "You're close to your calorie target for today."
        : proteinBehind
          ? `Protein is the bigger gap so far (${Math.round(proteinG)} of ${target.proteinG} g).`
          : 'Calories and protein are both on pace so far.';
    nextStep = isToday
      ? remainingKcal > 0
        ? remainingProteinG > 5
          ? `Aim for ~${Math.min(40, remainingProteinG)} g protein at ${nextMeal(input.localTime, meals)}, staying around ${kcal(remainingKcal)}.`
          : `You have about ${kcal(remainingKcal)} left for today.`
        : "You've reached today's target. Keep anything else light."
      : 'Repeat what worked: meals like these kept you on target.';
  }
  if (status !== 'not_logged' && burned.caloriesKcal > 0) {
    headline += ` Exercise burned ~${kcal(burned.caloriesKcal)} (${burned.durationMinutes} min), so your net is ${kcal(netKcal)}.`;
    if (isToday && remainingKcal > 0 && status !== 'over')
      nextStep =
        `${nextStep ? `${nextStep} ` : ''}Your workout leaves room for ~${kcal(remainingKcal)} more today.`.trim();
  }
  return {
    target,
    consumed: { caloriesKcal, proteinG },
    burned,
    netKcal,
    remainingKcal,
    remainingProteinG,
    deltaKcal: -remainingKcal,
    status,
    biggestMeal,
    insight: { headline, nextStep },
  };
}
/** Average calories for a meal category over earlier days; null below two samples. */
export function typicalMeal(
  entries: Entry[],
  category: NutritionData['mealCategory'],
): number | null {
  const values = entries
    .filter(
      (e) =>
        e.category === 'nutrition' &&
        (e.data as NutritionData).mealCategory === category &&
        e.summary.caloriesKcal !== null,
    )
    .map((e) => e.summary.caloriesKcal!);
  return values.length < 2
    ? null
    : values.reduce((sum, v) => sum + v, 0) / values.length;
}
