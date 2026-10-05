import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  NUTRITION_PROVIDER,
  OPEN_FOOD_FACTS_PROVIDER,
} from '../domain/nutrition-provider.js';
import type {
  NutritionProvider,
  NutritionProviderName,
} from '../domain/nutrition-provider.js';
@Injectable()
export class NutritionService {
  constructor(
    @Inject(NUTRITION_PROVIDER) private readonly usda: NutritionProvider,
    @Inject(OPEN_FOOD_FACTS_PROVIDER)
    private readonly openFoodFacts: NutritionProvider,
  ) {}
  resolve(value: unknown = 'usda-fdc'): {
    name: NutritionProviderName;
    provider: NutritionProvider;
  } {
    if (value === 'usda-fdc') return { name: value, provider: this.usda };
    if (value === 'open-food-facts')
      return { name: value, provider: this.openFoodFacts };
    throw new BadRequestException(
      'provider must be usda-fdc or open-food-facts',
    );
  }
}
