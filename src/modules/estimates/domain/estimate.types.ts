import type { FoodItem } from '../../entries/domain/entry.types.js';
import type { Food } from '../../nutrition/domain/nutrition-provider.js';
import type { MetKey } from './met-table.js';
export type EstimateCategory = 'nutrition' | 'exercise';
export interface EstimateRequest {
  category: EstimateCategory;
  title: string;
  note: string;
  image: { mimeType: string; base64: string };
}
/** A food the AI read from the note, before any database lookup. */
export interface ExtractedFood {
  name: string;
  searchQuery: string;
  quantity: number;
  unit: string;
  /** Portion in grams (or ml for drinks) used against the per-100 reference. */
  amount: number;
  amountUnit: 'g' | 'ml';
  branded: boolean;
}
export interface ExtractedActivity {
  activityName: string;
  metKey: MetKey;
  durationMinutes: number;
  intensity: 'light' | 'moderate' | 'vigorous';
}
export interface NutritionEstimate {
  category: 'nutrition';
  items: (FoodItem & {
    matchedName: string;
    amount: number;
    amountUnit: string;
  })[];
  unmatched: { name: string; reason: string }[];
  totals: {
    caloriesKcal: number;
    proteinG: number;
    carbohydratesG: number;
    fatG: number;
  };
}
export interface ExerciseEstimate {
  category: 'exercise';
  weightKg: number;
  activities: (ExtractedActivity & {
    met: number;
    caloriesBurnedKcal: number;
  })[];
  totals: { durationMinutes: number; caloriesBurnedKcal: number };
}
export type Estimate = NutritionEstimate | ExerciseEstimate;
export const ESTIMATE_AI = Symbol('ESTIMATE_AI');
export interface EstimateAi {
  extractFoods(
    userId: string,
    request: EstimateRequest,
  ): Promise<ExtractedFood[]>;
  /** For each food, the index of the best candidate or null when none is the same food. */
  pickFoods(
    userId: string,
    choices: { food: ExtractedFood; candidates: Food[] }[],
  ): Promise<(number | null)[]>;
  extractActivities(
    userId: string,
    request: EstimateRequest,
  ): Promise<ExtractedActivity[]>;
}
export const BODY_WEIGHT_REPOSITORY = Symbol('BODY_WEIGHT_REPOSITORY');
export interface BodyWeightRepository {
  latestKg(userId: string): Promise<number | null>;
}
