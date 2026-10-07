import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentUser,
  CurrentUserGuard,
} from '../../../common/identity/current-user.js';
import type { UserIdentity } from '../../../common/identity/current-user.js';
import { estimateInput } from '../application/estimate-input.js';
import { EstimateNutritionUseCase } from '../application/estimate-nutrition.use-case.js';
import { EstimateExerciseUseCase } from '../application/estimate-exercise.use-case.js';
/** Previews calories for a title + note + image; nothing is saved until the user confirms. */
@Controller('v1/estimates')
@UseGuards(CurrentUserGuard)
export class EstimatesController {
  constructor(
    @Inject(EstimateNutritionUseCase)
    private readonly nutrition: EstimateNutritionUseCase,
    @Inject(EstimateExerciseUseCase)
    private readonly exercise: EstimateExerciseUseCase,
  ) {}
  @Post() @HttpCode(200) estimate(
    @CurrentUser() user: UserIdentity,
    @Body() body: unknown,
  ) {
    const request = estimateInput(body);
    return request.category === 'nutrition'
      ? this.nutrition.execute(user.userId, request)
      : this.exercise.execute(user.userId, request);
  }
}
