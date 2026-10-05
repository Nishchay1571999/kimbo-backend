import { roundToTwoDecimals } from '../../../common/math/round.js';
import {
  BadGatewayException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  Food,
  FoodSearch,
  NutritionProvider,
} from '../domain/nutrition-provider.js';
export interface OpenFoodFactsProduct {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  generic_name?: string;
  nutrition_data_per?: string;
  nutriments?: Record<string, unknown>;
}
const FIELDS =
  'code,product_name,product_name_en,generic_name,nutrition_data_per,nutriments';
const PAGE_SIZE = 20;
export function normalizeOpenFoodFactsProduct(
  product: OpenFoodFactsProduct,
): Food {
  const code = product.code;
  const name = [
    product.product_name,
    product.product_name_en,
    product.generic_name,
  ]
    .find((value) => typeof value === 'string' && value.trim())
    ?.trim();
  if (typeof code !== 'string' || !/^\d{4,24}$/.test(code) || !name)
    throw new BadGatewayException('Invalid Open Food Facts product');
  const nutrient = (key: string): number | null => {
    const raw = product.nutriments?.[key];
    const value =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim()
          ? Number(raw)
          : NaN;
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  const kcal = nutrient('energy-kcal_100g');
  const kj = nutrient('energy-kj_100g') ?? nutrient('energy_100g');
  return {
    id: `open-food-facts:${code}`,
    provider: 'open-food-facts',
    providerFoodId: code,
    name,
    reference: {
      quantity: 100,
      unit: product.nutrition_data_per === '100ml' ? 'ml' : 'g',
    },
    nutrition: {
      caloriesKcal:
        kcal ?? (kj === null ? null : roundToTwoDecimals(kj / 4.184)),
      proteinG: nutrient('proteins_100g'),
      carbohydratesG: nutrient('carbohydrates_100g'),
      fatG: nutrient('fat_100g'),
    },
  };
}
@Injectable()
export class OpenFoodFactsProvider implements NutritionProvider {
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: unknown }
  >();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly windows = {
    search: { start: 0, count: 0 },
    product: { start: 0, count: 0 },
  };
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}
  private async request(
    path: string,
    parameters: Record<string, string>,
    kind: 'search' | 'product',
  ): Promise<unknown> {
    const staging =
      this.config.get('OPEN_FOOD_FACTS_ENVIRONMENT') === 'staging';
    const url = new URL(
      path,
      staging
        ? 'https://world.openfoodfacts.net'
        : 'https://world.openfoodfacts.org',
    );
    url.search = new URLSearchParams({
      ...parameters,
      fields: FIELDS,
    }).toString();
    const cacheKey = url.toString();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const running = this.inFlight.get(cacheKey);
    if (running) return running;
    const window = this.windows[kind];
    if (Date.now() - window.start >= 60000) {
      window.start = Date.now();
      window.count = 0;
    }
    if (window.count >= (kind === 'search' ? 10 : 15))
      throw new ServiceUnavailableException(
        'Open Food Facts request limit reached; retry later',
      );
    window.count += 1;
    const task = this.fetchAndCache(url, cacheKey, staging);
    this.inFlight.set(cacheKey, task);
    try {
      return await task;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }
  private async fetchAndCache(
    url: URL,
    cacheKey: string,
    staging: boolean,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent':
            this.config.get<string>('OPEN_FOOD_FACTS_USER_AGENT') ??
            'Kimbo/0.0.1 (local nutrition backend)',
          Accept: 'application/json',
          ...(staging
            ? {
                Authorization: `Basic ${Buffer.from('off:off').toString('base64')}`,
              }
            : {}),
        },
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new ServiceUnavailableException('Open Food Facts unavailable');
    }
    if (response.status === 404) throw new NotFoundException('Food not found');
    if (response.status === 429 || response.status === 503)
      throw new ServiceUnavailableException(
        'Open Food Facts temporarily unavailable; retry later',
      );
    if (!response.ok)
      throw new BadGatewayException('Open Food Facts request failed');
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new BadGatewayException('Invalid Open Food Facts response');
    }
    if (this.cache.size >= 200)
      this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(cacheKey, { expiresAt: Date.now() + 300000, value });
    return value;
  }
  async searchFoods(query: string, page: number): Promise<FoodSearch> {
    // The documented legacy search endpoint supports full text; v2 search does not.
    const response = (await this.request(
      '/cgi/search.pl',
      {
        search_terms: query,
        search_simple: '1',
        action: 'process',
        json: '1',
        page: String(page),
        page_size: String(PAGE_SIZE),
      },
      'search',
    )) as { products?: OpenFoodFactsProduct[]; count?: number };
    if (
      !response ||
      !Array.isArray(response.products) ||
      !Number.isInteger(response.count) ||
      response.count! < 0
    )
      throw new BadGatewayException('Invalid Open Food Facts search response');
    const foods: Food[] = [];
    for (const product of response.products) {
      try {
        foods.push(normalizeOpenFoodFactsProduct(product));
      } catch {
        /* Incomplete catalog rows are not usable confirmed foods. */
      }
    }
    return {
      foods,
      page,
      totalHits: response.count!,
      totalPages: Math.ceil(response.count! / PAGE_SIZE),
    };
  }
  async getFood(id: string): Promise<Food> {
    const response = (await this.request(
      `/api/v3/product/${id}.json`,
      {},
      'product',
    )) as { product?: OpenFoodFactsProduct; status?: number | string };
    if (
      !response ||
      response.status === 0 ||
      response.status === 'failure' ||
      !response.product
    )
      throw new NotFoundException('Food not found');
    return normalizeOpenFoodFactsProduct({
      ...response.product,
      code: response.product.code ?? id,
    });
  }
}
