import { calculatePortion } from './calculate-nutrition.use-case.js';
import { normalizeFood } from '../../infrastructure/usda-food-data-central.provider.js';
const food = normalizeFood({
  fdcId: 1,
  description: 'Rice',
  foodNutrients: [
    { nutrient: { id: 1008, unitName: 'kcal' }, amount: 130 },
    { nutrient: { id: 1003, unitName: 'g' }, amount: 2.7 },
  ],
});
describe('USDA normalization and portions', () => {
  it('supports detail and search nutrient forms, preserving unknown macros', () => {
    const search = normalizeFood({
      fdcId: 1,
      description: 'Rice',
      foodNutrients: [
        { nutrientId: 1008, unitName: 'KCAL', value: 130 },
        { nutrientId: 1003, unitName: 'G', value: 2.7 },
      ],
    });
    expect(search).toEqual(food);
    expect(food.nutrition.fatG).toBeNull();
  });
  it('scales 150 g to 195 kcal with reference provenance', () => {
    expect(calculatePortion(food, 150, 'g')).toMatchObject({
      caloriesKcal: 195,
      proteinG: 4.05,
      fatG: null,
      reference: { amount: 100, unit: 'g', provider: 'usda-fdc' },
    });
  });
  it('converts kilograms before scaling and rejects unconvertible pieces', () => {
    expect(calculatePortion(food, 0.15, 'kg').caloriesKcal).toBe(195);
    expect(() => calculatePortion(food, 2, 'piece')).toThrow();
  });
  it('does not infer zero calories from missing provider data', () => {
    expect(() =>
      calculatePortion(
        { ...food, nutrition: { ...food.nutrition, caloriesKcal: null } },
        100,
        'g',
      ),
    ).toThrow();
  });
  it('uses kcal energy before kJ and falls back to Atwater kcal', () => {
    expect(
      normalizeFood({
        fdcId: 1,
        description: 'Rice',
        foodNutrients: [{ nutrientId: 1062, unitName: 'kJ', value: 543.92 }],
      }).nutrition.caloriesKcal,
    ).toBe(130);
    expect(
      normalizeFood({
        fdcId: 1,
        description: 'Rice',
        foodNutrients: [{ nutrientId: 2048, unitName: 'kcal', value: 130 }],
      }).nutrition.caloriesKcal,
    ).toBe(130);
  });
});
