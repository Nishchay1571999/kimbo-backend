import type { Entry } from '../../entries/domain/entry.types.js';
export const AI_PROVIDER = Symbol('AI_PROVIDER');
export interface AiAnalysis {
  synopsis: string;
  structured: { observations: string[] };
  providerModelId: string;
  modelId: string;
}
export interface AiProvider {
  analyse(userId: string, entry: Entry): Promise<AiAnalysis>;
}
export class AiProviderError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
