import { Inject, Injectable } from '@nestjs/common';
import { roundToTwoDecimals } from '../../../common/math/round.js';
import { NutritionService } from '../../nutrition/application/nutrition.service.js';
import { calculatePortion } from '../../nutrition/application/calculate-nutrition/calculate-nutrition.use-case.js';
import type {
  Food,
  NutritionProviderName,
} from '../../nutrition/domain/nutrition-provider.js';
import { ESTIMATE_AI } from '../domain/estimate.types.js';
import type {
  EstimateAi,
  EstimateRequest,
  ExtractedFood,
  NutritionEstimate,
} from '../domain/estimate.types.js';
import { unprocessable, withAi } from './estimate-errors.js';
const CANDIDATES = 5;
@Injectable()
export class EstimateNutritionUseCase {
  constructor(
    @Inject(ESTIMATE_AI) private readonly ai: EstimateAi,
    @Inject(NutritionService) private readonly nutrition: NutritionService,
  ) {}
  async execute(
    userId: string,
    request: EstimateRequest,
  ): Promise<NutritionEstimate> {
    const foods = await withAi(() => this.ai.extractFoods(userId, request));
    if (foods.length === 0)
      throw unprocessable(
        'ESTIMATE_NO_FOOD_FOUND',
        'We couldn\'t find any food in your note. Describe what you ate, e.g. "2 rotis, a bowl of dal and a coke".',
      );
    const candidates = await Promise.all(foods.map((f) => this.search(f)));
    const searchable = foods
      .map((food, index) => ({ food, candidates: candidates[index], index }))
      .filter((c) => c.candidates.length > 0);
    const picks = searchable.length
      ? await withAi(() => this.ai.pickFoods(userId, searchable))
      : [];
    const chosen = new Map<number, Food>();
    searchable.forEach((c, i) => {
      const pick = picks[i];
      if (pick !== null && pick !== undefined && c.candidates[pick])
        chosen.set(c.index, c.candidates[pick]);
    });
    const items: NutritionEstimate['items'] = [];
    const unmatched: NutritionEstimate['unmatched'] = [];
    foods.forEach((food, index) => {
      const match = chosen.get(index);
      if (!match) {
        unmatched.push({
          name: food.name,
          reason: candidates[index].length
            ? 'No close match in USDA or Open Food Facts'
            : 'Not found in USDA or Open Food Facts',
        });
        return;
      }
      // Mass and volume are treated as interchangeable (density ≈ 1) for estimates.
      const portion = calculatePortion(
        match,
        food.amount,
        match.reference.unit,
      );
      items.push({
        ...portion,
        name: food.name,
        quantity: food.quantity,
        unit: food.unit,
        quantitySource: 'estimated',
        matchedName: match.name,
        amount: food.amount,
        amountUnit: match.reference.unit,
      });
    });
    if (items.length === 0)
      throw unprocessable(
        'ESTIMATE_NO_MATCH',
        "We couldn't match the foods in your note to USDA or Open Food Facts. Try simpler names.",
        { unmatched },
      );
    const sum = (
      pick: (item: NutritionEstimate['items'][number]) => number | null,
    ) =>
      roundToTwoDecimals(
        items.reduce((total, item) => total + (pick(item) ?? 0), 0),
      );
    return {
      category: 'nutrition',
      items,
      unmatched,
      totals: {
        caloriesKcal: sum((i) => i.caloriesKcal),
        proteinG: sum((i) => i.proteinG),
        carbohydratesG: sum((i) => i.carbohydratesG),
        fatG: sum((i) => i.fatG),
      },
    };
  }
  /** Branded products are looked up in Open Food Facts first, everything else in USDA. */
  private async search(food: ExtractedFood): Promise<Food[]> {
    const order: NutritionProviderName[] = food.branded
      ? ['open-food-facts', 'usda-fdc']
      : ['usda-fdc', 'open-food-facts'];
    for (const name of order) {
      try {
        const { foods } = await this.nutrition
          .resolve(name)
          .provider.searchFoods(food.searchQuery, 1);
        const usable = foods.filter((f) => f.nutrition.caloriesKcal !== null);
        if (usable.length) return usable.slice(0, CANDIDATES);
      } catch {
        // A provider outage falls through to the other database.
      }
    }
    return [];
  }
}
