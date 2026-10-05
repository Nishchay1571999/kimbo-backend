import { NutritionService } from './nutrition.service.js';
import { foodId } from './search-food/search-food.use-case.js';
import { vi } from 'vitest';
it('selects USDA by default and routes Open Food Facts through the same port', () => {
  const usda = { searchFoods: vi.fn(), getFood: vi.fn() };
  const off = { searchFoods: vi.fn(), getFood: vi.fn() };
  const service = new NutritionService(usda, off);
  expect(service.resolve().provider).toBe(usda);
  expect(service.resolve('open-food-facts').provider).toBe(off);
  expect(() => service.resolve('unknown')).toThrow();
});
it('validates IDs per provider without converting barcodes to numbers', () => {
  expect(foodId('0030000012000', 'open-food-facts')).toBe('0030000012000');
  expect(() => foodId('0030000012000', 'usda-fdc')).toThrow();
  expect(() => foodId('../secret', 'open-food-facts')).toThrow();
});
