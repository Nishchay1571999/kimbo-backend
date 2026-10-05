import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import {
  CurrentUser,
  CurrentUserGuard,
} from '../../../common/identity/current-user.js';
import type { UserIdentity } from '../../../common/identity/current-user.js';
import { SearchFoodUseCase } from '../application/search-food/search-food.use-case.js';
import { CalculateNutritionUseCase } from '../application/calculate-nutrition/calculate-nutrition.use-case.js';
@Controller('v1/nutrition')
@UseGuards(CurrentUserGuard)
export class NutritionController {
  constructor(
    @Inject(SearchFoodUseCase) private readonly searchFood: SearchFoodUseCase,
    @Inject(CalculateNutritionUseCase)
    private readonly calculateNutrition: CalculateNutritionUseCase,
  ) {}
  @Get('search') search(
    @CurrentUser() user: UserIdentity,
    @Query('q') q: string,
    @Query('page') page?: string,
    @Query('provider') provider?: string,
  ) {
    return this.searchFood.execute(
      user.userId,
      q,
      page === undefined ? 1 : Number(page),
      provider,
    );
  }
  @Get('foods/:id') food(
    @CurrentUser() user: UserIdentity,
    @Param('id') id: string,
    @Query('provider') provider?: string,
  ) {
    return this.searchFood.getFood(user.userId, id, provider);
  }
  @Post('calculate') @HttpCode(200) calculate(
    @CurrentUser() user: UserIdentity,
    @Body() body: unknown,
  ) {
    return this.calculateNutrition.execute(user.userId, body);
  }
}
