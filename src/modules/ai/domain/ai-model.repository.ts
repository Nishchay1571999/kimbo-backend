export const AI_MODEL_REPOSITORY = Symbol('AI_MODEL_REPOSITORY');
export interface AllowedAiModel {
  id: string;
  name: string;
  provider: string;
  providerModelId: string;
  supportsText: boolean;
  supportsImages: boolean;
  supportsAudio: boolean;
}
export interface AiModelRepository {
  selectForEntry(
    userId: string,
    audio: boolean,
  ): Promise<AllowedAiModel | null>;
  findAllowed(
    userId: string,
    providerModelId: string,
    audio: boolean,
  ): Promise<AllowedAiModel | null>;
  list(userId: string): Promise<AllowedAiModel[]>;
}
