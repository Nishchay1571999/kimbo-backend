import type { NutritionValues } from './nutrition.types.js';
export interface Food {
  id: string;
  provider: string;
  providerFoodId: string;
  name: string;
  reference: { quantity: number; unit: 'g' | 'ml' };
  nutrition: NutritionValues;
}
export interface FoodSearch {
  foods: Food[];
  page: number;
  totalPages: number;
  totalHits: number;
}
export type NutritionProviderName = 'usda-fdc' | 'open-food-facts';
export const OPEN_FOOD_FACTS_PROVIDER = Symbol('OPEN_FOOD_FACTS_PROVIDER');
export const NUTRITION_PROVIDER = Symbol('NUTRITION_PROVIDER');
export interface NutritionProvider {
  searchFoods(query: string, page: number): Promise<FoodSearch>;
  getFood(id: string): Promise<Food>;
}
