import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { NutritionService } from '../nutrition.service.js';
import type { NutritionProviderName } from '../../domain/nutrition-provider.js';
import { text } from '../../../../common/validation/input.js';
export function foodId(
  id: unknown,
  provider: NutritionProviderName = 'usda-fdc',
): string {
  if (provider === 'open-food-facts') {
    if (typeof id !== 'string' || !/^\d{4,24}$/.test(id))
      throw new BadRequestException('Invalid product barcode');
    return id;
  }
  if (typeof id !== 'string' || !/^[1-9]\d{0,9}$/.test(id))
    throw new BadRequestException('Invalid food ID');
  return id;
}
@Injectable()
export class SearchFoodUseCase {
  constructor(
    @Inject(NutritionService) private readonly nutrition: NutritionService,
  ) {}
  execute(
    _userId: string,
    query: unknown,
    page: number,
    providerName?: unknown,
  ) {
    if (!Number.isInteger(page) || page < 1 || page > 1000)
      throw new BadRequestException('Invalid page');
    return this.nutrition
      .resolve(providerName)
      .provider.searchFoods(text(query, 'q'), page);
  }
  getFood(_userId: string, id: string, providerName?: unknown) {
    const { name, provider } = this.nutrition.resolve(providerName);
    return provider.getFood(foodId(id, name));
  }
}
