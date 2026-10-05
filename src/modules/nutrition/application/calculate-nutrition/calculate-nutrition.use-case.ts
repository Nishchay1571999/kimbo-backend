import { roundToTwoDecimals } from '../../../../common/math/round.js';
import {
  BadRequestException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NutritionService } from '../nutrition.service.js';
import type { Food } from '../../domain/nutrition-provider.js';
import type { FoodItem } from '../../../entries/domain/entry.types.js';
import { keys, number, object } from '../../../../common/validation/input.js';
import { foodId } from '../search-food/search-food.use-case.js';
export function calculatePortion(
  food: Food,
  quantity: number,
  unit: string,
): FoodItem {
  const units = food.reference.unit === 'ml' ? ['ml', 'l'] : ['g', 'kg', 'oz'];
  if (!units.includes(unit))
    throw new BadRequestException(
      `Use ${units.join(', ')} for this food reference; mass and volume require a known density`,
    );
  number(quantity, 'quantity', true);
  if (food.nutrition.caloriesKcal === null)
    throw new UnprocessableEntityException(
      'Food has no calorie reference; enter confirmed nutrition manually',
    );
  const referenceAmount =
    quantity *
    (unit === 'kg' || unit === 'l' ? 1000 : unit === 'oz' ? 28.349523125 : 1);
  const ratio = referenceAmount / food.reference.quantity;
  const scale = (value: number | null): number | null =>
    value === null ? null : roundToTwoDecimals(value * ratio);
  const caloriesKcal = scale(food.nutrition.caloriesKcal)!;
  if (!Number.isFinite(caloriesKcal))
    throw new BadRequestException('Quantity is too large');
  return {
    id: randomUUID(),
    name: food.name,
    quantity,
    unit,
    caloriesKcal,
    proteinG: scale(food.nutrition.proteinG),
    carbohydratesG: scale(food.nutrition.carbohydratesG),
    fatG: scale(food.nutrition.fatG),
    quantitySource: 'user_entered',
    nutritionSource: 'reference',
    reference: {
      provider: food.provider,
      providerFoodId: food.providerFoodId,
      amount: food.reference.quantity,
      unit: food.reference.unit,
    },
  };
}
@Injectable()
export class CalculateNutritionUseCase {
  constructor(
    @Inject(NutritionService) private readonly nutrition: NutritionService,
  ) {}
  async execute(_userId: string, raw: unknown): Promise<FoodItem> {
    const input = object(raw, 'portion');
    keys(input, ['provider', 'providerFoodId', 'quantity', 'unit']);
    const { name, provider } = this.nutrition.resolve(input.provider);
    const id = foodId(input.providerFoodId, name);
    const quantity = number(input.quantity, 'quantity', true);
    if (
      typeof input.unit !== 'string' ||
      !['g', 'kg', 'oz', 'ml', 'l'].includes(input.unit)
    )
      throw new BadRequestException('Use g, kg, oz, ml, or l');
    return calculatePortion(await provider.getFood(id), quantity, input.unit);
  }
}
