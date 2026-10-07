import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/database/prisma.module.js';
import { CurrentUserModule } from '../../common/identity/current-user.js';
import { AiModule } from '../ai/ai.module.js';
import { NutritionModule } from '../nutrition/nutrition.module.js';
import { EstimateExerciseUseCase } from './application/estimate-exercise.use-case.js';
import { EstimateNutritionUseCase } from './application/estimate-nutrition.use-case.js';
import {
  BODY_WEIGHT_REPOSITORY,
  ESTIMATE_AI,
} from './domain/estimate.types.js';
import { OpenRouterEstimateAi } from './infrastructure/openrouter-estimate.ai.js';
import { PrismaBodyWeightRepository } from './infrastructure/prisma-body-weight.repository.js';
import { EstimatesController } from './presentation/estimates.controller.js';
@Module({
  imports: [PrismaModule, CurrentUserModule, AiModule, NutritionModule],
  controllers: [EstimatesController],
  providers: [
    { provide: ESTIMATE_AI, useClass: OpenRouterEstimateAi },
    { provide: BODY_WEIGHT_REPOSITORY, useClass: PrismaBodyWeightRepository },
    EstimateNutritionUseCase,
    EstimateExerciseUseCase,
  ],
})
export class EstimatesModule {}
