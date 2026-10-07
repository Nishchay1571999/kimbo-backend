import {
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AiProviderError } from '../../ai/domain/ai-provider.js';
export function unprocessable(
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return new UnprocessableEntityException({ code, message, ...extra });
}
/** Runs an AI step, turning provider failures into a retryable 503 the app can show. */
export async function withAi<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof AiProviderError)
      throw new ServiceUnavailableException({
        code: 'ESTIMATE_AI_UNAVAILABLE',
        message: 'Kimo could not read your note right now. Please try again.',
        reason: error.code,
      });
    throw error;
  }
}
