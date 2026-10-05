import { CurrentUserModule } from '../../common/identity/current-user.js';
import { AI_MODEL_REPOSITORY } from './domain/ai-model.repository.js';
import { PrismaAiModelRepository } from './infrastructure/prisma-ai-model.repository.js';
import { AiModelsController } from './presentation/ai-models.controller.js';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/database/prisma.module.js';
import { AI_PROVIDER } from './domain/ai-provider.js';
import { ANALYSIS_WORK_REPOSITORY } from './domain/analysis-work.repository.js';
import { OpenRouterAiProvider } from './infrastructure/openrouter-ai.provider.js';
import { PrismaAnalysisWorkRepository } from './infrastructure/prisma-analysis-work.repository.js';
import { AnalyseEntryUseCase } from './application/analyse-entry/analyse-entry.use-case.js';
import { AnalysisWorker } from './infrastructure/analysis-worker.js';
@Module({
  imports: [PrismaModule, CurrentUserModule],
  controllers: [AiModelsController],
  providers: [
    { provide: AI_MODEL_REPOSITORY, useClass: PrismaAiModelRepository },
    { provide: AI_PROVIDER, useClass: OpenRouterAiProvider },
    {
      provide: ANALYSIS_WORK_REPOSITORY,
      useClass: PrismaAnalysisWorkRepository,
    },
    AnalyseEntryUseCase,
    AnalysisWorker,
  ],
})
export class AiModule {}
