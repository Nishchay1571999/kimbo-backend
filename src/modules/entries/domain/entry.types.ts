import { roundToTwoDecimals } from '../../../common/math/round.js';
import type { NutritionValues } from '../../nutrition/domain/nutrition.types.js';
export type EntryCategory = 'note' | 'nutrition' | 'exercise';
export interface FoodReference {
  provider: string;
  providerFoodId: string;
  amount: number;
  unit: string;
}
export interface FoodItem extends NutritionValues {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  quantitySource: 'user_entered' | 'estimated';
  nutritionSource: 'user_entered' | 'estimated' | 'reference';
  reference?: FoodReference;
}
export interface NutritionData {
  mealCategory: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';
  items: FoodItem[];
}
export interface ExerciseData {
  activityName: string;
  durationMinutes: number;
  intensity: 'light' | 'moderate' | 'vigorous';
  estimatedCaloriesBurnedKcal: number | null;
  calorieEstimationSource: string | null;
  /** Per-activity breakdown when one note described several activities. */
  activities?: ExerciseActivity[];
}
export interface ExerciseActivity {
  activityName: string;
  durationMinutes: number;
  intensity: 'light' | 'moderate' | 'vigorous';
  met: number | null;
  caloriesBurnedKcal: number;
}
export type EntryData = NutritionData | ExerciseData | Record<string, never>;
export interface Attachment {
  id: string;
  type: 'image' | 'audio';
  base64: string;
  mimeType: string;
  fileSizeBytes: number;
  widthPx?: number;
  heightPx?: number;
  durationMs?: number;
}
export interface EntryContent {
  category: EntryCategory;
  title: string;
  entryDate: string;
  occurredAt: string;
  recordedTimezone: string;
  inputSource: 'text' | 'image' | 'audio' | 'mixed';
  note: string | null;
  attachments: Attachment[];
  data: EntryData;
}
export interface Entry extends EntryContent {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  summary: { caloriesKcal: number | null };
  ai: {
    status: 'not_requested' | 'pending' | 'processing' | 'completed' | 'failed';
    synopsis: string | null;
    errorCode?: string | null;
  };
}
export function mealCalories(data: NutritionData): number {
  return roundToTwoDecimals(
    data.items.reduce((sum, item) => sum + (item.caloriesKcal ?? 0), 0),
  );
}
