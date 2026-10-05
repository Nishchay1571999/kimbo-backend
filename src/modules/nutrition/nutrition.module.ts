import { NutritionService } from './application/nutrition.service.js';
import { OpenFoodFactsProvider } from './infrastructure/open-food-facts.provider.js';
import { Module } from '@nestjs/common';
import { CurrentUserModule } from '../../common/identity/current-user.js';
import {
  NUTRITION_PROVIDER,
  OPEN_FOOD_FACTS_PROVIDER,
} from './domain/nutrition-provider.js';
import { UsdaFoodDataCentralProvider } from './infrastructure/usda-food-data-central.provider.js';
import { SearchFoodUseCase } from './application/search-food/search-food.use-case.js';
import { CalculateNutritionUseCase } from './application/calculate-nutrition/calculate-nutrition.use-case.js';
import { NutritionController } from './presentation/nutrition.controller.js';
@Module({
  imports: [CurrentUserModule],
  controllers: [NutritionController],
  providers: [
    { provide: NUTRITION_PROVIDER, useClass: UsdaFoodDataCentralProvider },
    { provide: OPEN_FOOD_FACTS_PROVIDER, useClass: OpenFoodFactsProvider },
    NutritionService,
    SearchFoodUseCase,
    CalculateNutritionUseCase,
  ],
})
export class NutritionModule {}
