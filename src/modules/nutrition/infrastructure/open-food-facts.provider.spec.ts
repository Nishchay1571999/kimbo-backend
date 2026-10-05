import { ConfigService } from '@nestjs/config';
import { vi } from 'vitest';
import {
  normalizeOpenFoodFactsProduct,
  OpenFoodFactsProvider,
} from './open-food-facts.provider.js';
import { calculatePortion } from '../application/calculate-nutrition/calculate-nutrition.use-case.js';
const product = {
  code: '0030000012000',
  product_name: 'Breakfast cereal',
  nutriments: {
    'energy-kcal_100g': 400,
    proteins_100g: 8,
    carbohydrates_100g: 75,
    fat_100g: 5,
  },
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('Open Food Facts normalization', () => {
  it('preserves leading-zero barcodes and scales nutrition for the actual portion', () => {
    const food = normalizeOpenFoodFactsProduct(product);
    expect(food).toMatchObject({
      id: 'open-food-facts:0030000012000',
      provider: 'open-food-facts',
      providerFoodId: '0030000012000',
      reference: { quantity: 100, unit: 'g' },
    });
    expect(calculatePortion(food, 30, 'g')).toMatchObject({
      caloriesKcal: 120,
      proteinG: 2.4,
      carbohydratesG: 22.5,
      fatG: 1.5,
      reference: { provider: 'open-food-facts', providerFoodId: product.code },
    });
  });
  it('keeps missing nutrients unknown, accepts numeric strings and converts kJ', () => {
    expect(
      normalizeOpenFoodFactsProduct({
        ...product,
        nutriments: { energy_100g: '418.4', proteins_100g: '', fat_100g: -1 },
      }).nutrition,
    ).toEqual({
      caloriesKcal: 100,
      proteinG: null,
      carbohydratesG: null,
      fatG: null,
    });
    expect(
      normalizeOpenFoodFactsProduct({ ...product, nutriments: {} }).nutrition
        .caloriesKcal,
    ).toBeNull();
  });
  it('respects an explicit volume basis without guessing a density', () => {
    const beverage = normalizeOpenFoodFactsProduct({
      ...product,
      nutrition_data_per: '100ml',
    });
    expect(calculatePortion(beverage, 0.25, 'l').caloriesKcal).toBe(1000);
    expect(() => calculatePortion(beverage, 250, 'g')).toThrow();
  });
});
describe('Open Food Facts transport', () => {
  it('uses the v3 barcode API with app identification and caches repeated reads', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ status: 'success', product })),
      );
    vi.stubGlobal('fetch', fetcher);
    const provider = new OpenFoodFactsProvider(
      new ConfigService({ OPEN_FOOD_FACTS_USER_AGENT: 'Kimbo/0.0.1 (test)' }),
    );
    expect(await provider.getFood(product.code)).toEqual(
      await provider.getFood(product.code),
    );
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0];
    expect(url.pathname).toBe(`/api/v3/product/${product.code}.json`);
    expect(options.headers['User-Agent']).toBe('Kimbo/0.0.1 (test)');
    expect(options.headers).not.toHaveProperty('Authorization');
  });
  it('uses full-text search, drops incomplete rows and preserves pagination', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            count: 21,
            products: [product, { code: '00000000', nutriments: {} }],
          }),
        ),
      );
    vi.stubGlobal('fetch', fetcher);
    const result = await new OpenFoodFactsProvider(
      new ConfigService(),
    ).searchFoods('cereal', 2);
    expect(result).toMatchObject({ page: 2, totalHits: 21, totalPages: 2 });
    expect(result.foods).toHaveLength(1);
    expect(fetcher.mock.calls[0][0].searchParams.get('search_terms')).toBe(
      'cereal',
    );
  });
  it('recognizes product-not-found responses even with HTTP 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 0 }))),
    );
    await expect(
      new OpenFoodFactsProvider(new ConfigService()).getFood('00000000'),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('sanitizes upstream rate-limit failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('upstream details', { status: 429 })),
    );
    await expect(
      new OpenFoodFactsProvider(new ConfigService()).getFood(product.code),
    ).rejects.toMatchObject({ status: 503 });
  });
  it('caps local searches at ten per minute, while cache hits do not consume calls', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(
          async () =>
            new Response(JSON.stringify({ count: 1, products: [product] })),
        ),
    );
    const provider = new OpenFoodFactsProvider(new ConfigService());
    for (let i = 0; i < 10; i++) await provider.searchFoods(`cereal ${i}`, 1);
    await provider.searchFoods('cereal 0', 1);
    await expect(provider.searchFoods('cereal extra', 1)).rejects.toMatchObject(
      { status: 503 },
    );
  });
});
