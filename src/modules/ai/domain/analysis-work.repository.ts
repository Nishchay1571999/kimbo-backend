import type { Entry } from '../../entries/domain/entry.types.js';
import type { AiAnalysis } from './ai-provider.js';
export const ANALYSIS_WORK_REPOSITORY = Symbol('ANALYSIS_WORK_REPOSITORY');
export interface AnalysisWork {
  userId: string;
  entry: Entry;
  detailsId: string;
  revision: number;
  attempt: number;
  lockedUntil: Date;
}
export interface AnalysisWorkRepository {
  claim(userId?: string, entryId?: string): Promise<AnalysisWork | null>;
  complete(
    userId: string,
    work: AnalysisWork,
    output: AiAnalysis,
  ): Promise<boolean>;
  fail(userId: string, work: AnalysisWork, code: string): Promise<void>;
}
