import { roundToTwoDecimals } from '../../../common/math/round.js';
import {
  BadGatewayException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Food, NutritionProvider } from '../domain/nutrition-provider.js';
interface UsdaNutrient {
  nutrientId?: number;
  nutrientNumber?: string;
  value?: number;
  amount?: number;
  unitName?: string;
  nutrient?: { id: number; number?: string; unitName: string };
}
export interface UsdaFood {
  fdcId: number;
  description: string;
  foodNutrients?: UsdaNutrient[];
}
export function normalizeFood(food: UsdaFood): Food {
  if (!Number.isInteger(food.fdcId) || typeof food.description !== 'string')
    throw new BadGatewayException('Invalid nutrition provider response');
  const nutrient = (ids: number[], unit: string): number | null => {
    for (const id of ids) {
      const row = food.foodNutrients?.find(
        (n) =>
          (n.nutrient?.id ?? n.nutrientId) === id &&
          (n.nutrient?.unitName ?? n.unitName)?.toLowerCase() === unit,
      );
      const value = row?.amount ?? row?.value;
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
        return value;
    }
    return null;
  };
  const kcal = nutrient([1008, 2048, 2047], 'kcal');
  const kj = nutrient([1062], 'kj');
  return {
    id: `usda:${food.fdcId}`,
    provider: 'usda-fdc',
    providerFoodId: String(food.fdcId),
    name: food.description,
    reference: { quantity: 100, unit: 'g' },
    nutrition: {
      caloriesKcal:
        kcal ?? (kj === null ? null : roundToTwoDecimals(kj / 4.184)),
      proteinG: nutrient([1003], 'g'),
      carbohydratesG: nutrient([1005], 'g'),
      fatG: nutrient([1004], 'g'),
    },
  };
}
@Injectable()
export class UsdaFoodDataCentralProvider implements NutritionProvider {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}
  private async request(
    path: string,
    parameters: Record<string, string> = {},
  ): Promise<unknown> {
    const key = this.config.get<string>('USDA_FDC_API_KEY');
    if (!key)
      throw new ServiceUnavailableException(
        'Nutrition provider is not configured',
      );
    const url = new URL(`https://api.nal.usda.gov/fdc/v1/${path}`);
    url.search = new URLSearchParams({
      api_key: key,
      ...parameters,
    }).toString();
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    } catch {
      throw new ServiceUnavailableException('Nutrition provider unavailable');
    }
    if (response.status === 404) throw new NotFoundException('Food not found');
    if (response.status === 429)
      throw new ServiceUnavailableException(
        'Nutrition provider rate limit reached',
      );
    if (!response.ok)
      throw new BadGatewayException('Nutrition provider request failed');
    try {
      return await response.json();
    } catch {
      throw new BadGatewayException('Invalid nutrition provider response');
    }
  }
  async searchFoods(query: string, page: number) {
    const response = (await this.request('foods/search', {
      query,
      pageSize: '20',
      pageNumber: String(page),
    })) as { foods: UsdaFood[]; totalPages: number; totalHits: number };
    if (!Array.isArray(response.foods))
      throw new BadGatewayException('Invalid nutrition provider response');
    return {
      foods: response.foods.map(normalizeFood),
      page,
      totalPages: response.totalPages,
      totalHits: response.totalHits,
    };
  }
  async getFood(id: string): Promise<Food> {
    return normalizeFood((await this.request(`food/${id}`)) as UsdaFood);
  }
}
