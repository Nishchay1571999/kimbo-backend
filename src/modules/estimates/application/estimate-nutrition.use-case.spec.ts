import { EstimateNutritionUseCase } from './estimate-nutrition.use-case.js';
import { AiProviderError } from '../../ai/domain/ai-provider.js';
import type { Food } from '../../nutrition/domain/nutrition-provider.js';
import type {
  EstimateRequest,
  ExtractedFood,
} from '../domain/estimate.types.js';
const request: EstimateRequest = {
  category: 'nutrition',
  title: 'Lunch',
  note: '2 rotis, dal and a coke',
  image: { mimeType: 'image/jpeg', base64: 'AAAA' },
};
const food = (
  id: string,
  name: string,
  kcal: number | null,
  unit: 'g' | 'ml' = 'g',
): Food => ({
  id,
  provider: 'usda-fdc',
  providerFoodId: id,
  name,
  reference: { quantity: 100, unit },
  nutrition: { caloriesKcal: kcal, proteinG: 10, carbohydratesG: 20, fatG: 5 },
});
const extracted = (
  name: string,
  amount: number,
  branded = false,
): ExtractedFood => ({
  name,
  searchQuery: name,
  quantity: 1,
  unit: 'serving',
  amount,
  amountUnit: 'g',
  branded,
});
function setup(
  results: Record<string, Record<string, Food[]>>,
  foods: ExtractedFood[],
  picks?: (number | null)[],
) {
  const ai = {
    extractFoods: vi.fn().mockResolvedValue(foods),
    pickFoods: vi.fn(
      async (_u: string, choices: unknown[]) => picks ?? choices.map(() => 0),
    ),
    extractActivities: vi.fn(),
  };
  const searched: string[] = [];
  const nutrition = {
    resolve: (name: string) => ({
      name,
      provider: {
        searchFoods: async (q: string) => {
          searched.push(`${name}:${q}`);
          if (results[name] === undefined) throw new Error('down');
          return {
            foods: results[name][q] ?? [],
            page: 1,
            totalPages: 1,
            totalHits: 0,
          };
        },
        getFood: vi.fn(),
      },
    }),
  };
  return {
    useCase: new EstimateNutritionUseCase(ai, nutrition as never),
    ai,
    searched,
  };
}
describe('EstimateNutritionUseCase', () => {
  it('splits the note, matches each food and scales calories to the estimated portion', async () => {
    const { useCase, searched } = setup(
      {
        'usda-fdc': {
          roti: [food('1', 'Chapati', 300)],
          dal: [food('2', 'Lentils, cooked', 116)],
        },
        'open-food-facts': { coke: [food('3', 'Coca-Cola', 42, 'ml')] },
      },
      [
        extracted('roti', 80),
        extracted('dal', 200),
        extracted('coke', 330, true),
      ],
    );
    const result = await useCase.execute('u', request);
    expect(searched).toEqual([
      'usda-fdc:roti',
      'usda-fdc:dal',
      'open-food-facts:coke',
    ]);
    expect(
      result.items.map((i) => [i.name, i.matchedName, i.caloriesKcal]),
    ).toEqual([
      ['roti', 'Chapati', 240],
      ['dal', 'Lentils, cooked', 232],
      ['coke', 'Coca-Cola', 138.6],
    ]);
    expect(result.items[0]).toMatchObject({
      quantitySource: 'estimated',
      nutritionSource: 'reference',
    });
    expect(result.totals.caloriesKcal).toBe(610.6);
    expect(result.unmatched).toEqual([]);
  });
  it('falls back to the other database and flags foods it cannot match', async () => {
    const { useCase } = setup(
      {
        'usda-fdc': {},
        'open-food-facts': {
          idli: [food('9', 'Idli', 130)],
          mystery: [food('8', 'Paint', 10)],
        },
      },
      [extracted('idli', 100), extracted('mystery', 50), extracted('zzz', 10)],
      [0, null],
    );
    const result = await useCase.execute('u', request);
    expect(result.items.map((i) => i.name)).toEqual(['idli']);
    expect(result.unmatched).toEqual([
      { name: 'mystery', reason: 'No close match in USDA or Open Food Facts' },
      { name: 'zzz', reason: 'Not found in USDA or Open Food Facts' },
    ]);
  });
  it('ignores candidates without calories and survives a provider outage', async () => {
    const { useCase } = setup(
      {
        'open-food-facts': {
          rice: [food('1', 'Rice', null), food('2', 'Rice cooked', 130)],
        },
      },
      [extracted('rice', 150)],
    );
    const result = await useCase.execute('u', request);
    expect(result.items[0]).toMatchObject({
      matchedName: 'Rice cooked',
      caloriesKcal: 195,
    });
  });
  it('rejects notes with no food', async () => {
    const { useCase } = setup({}, []);
    await expect(useCase.execute('u', request)).rejects.toMatchObject({
      response: { code: 'ESTIMATE_NO_FOOD_FOUND' },
    });
  });
  it('rejects when nothing matches, listing the unmatched foods', async () => {
    const { useCase } = setup({ 'usda-fdc': {}, 'open-food-facts': {} }, [
      extracted('qwerty', 10),
    ]);
    await expect(useCase.execute('u', request)).rejects.toMatchObject({
      response: { code: 'ESTIMATE_NO_MATCH', unmatched: [{ name: 'qwerty' }] },
    });
  });
  it('turns AI failures into a retryable error', async () => {
    const { useCase, ai } = setup({}, []);
    ai.extractFoods.mockRejectedValue(new AiProviderError('AI_RATE_LIMITED'));
    await expect(useCase.execute('u', request)).rejects.toMatchObject({
      status: 503,
      response: { code: 'ESTIMATE_AI_UNAVAILABLE', reason: 'AI_RATE_LIMITED' },
    });
  });
});
