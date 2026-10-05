import { Inject, Injectable } from '@nestjs/common';
import { AI_PROVIDER, AiProviderError } from '../../domain/ai-provider.js';
import type { AiProvider } from '../../domain/ai-provider.js';
import { ANALYSIS_WORK_REPOSITORY } from '../../domain/analysis-work.repository.js';
import type { AnalysisWorkRepository } from '../../domain/analysis-work.repository.js';
@Injectable()
export class AnalyseEntryUseCase {
  constructor(
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
    @Inject(ANALYSIS_WORK_REPOSITORY)
    private readonly work: AnalysisWorkRepository,
  ) {}
  async execute(userId?: string, entryId?: string): Promise<boolean> {
    const claim = await this.work.claim(userId, entryId);
    if (!claim) return false;
    try {
      const result = await this.provider.analyse(claim.userId, claim.entry);
      await this.work.complete(claim.userId, claim, result);
    } catch (error) {
      await this.work.fail(
        claim.userId,
        claim,
        error instanceof AiProviderError ? error.code : 'AI_ANALYSIS_ERROR',
      );
    }
    return true;
  }
}
