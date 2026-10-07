import type { ConfigService } from '@nestjs/config';
import type { AiModelRepository } from '../domain/ai-model.repository.js';
import { AiProviderError } from '../domain/ai-provider.js';
export type OpenRouterContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | {
      type: 'input_audio';
      input_audio: { data: string; format: 'wav' | 'mp3' | 'm4a' };
    };
export interface JsonCompletion {
  userId: string;
  system: string;
  content: OpenRouterContent[];
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  audio?: boolean;
  timeoutMs?: number;
}
export interface JsonCompletionResult {
  result: unknown;
  providerModelId: string;
  modelId: string;
}
/** One structured-output chat completion against a registered, entry-capable model. */
export class OpenRouterJsonClient {
  constructor(
    private readonly config: ConfigService,
    private readonly models: AiModelRepository,
  ) {}
  async complete(request: JsonCompletion): Promise<JsonCompletionResult> {
    const key = this.config.get<string>('OPENROUTER_API_KEY');
    if (!key) throw new AiProviderError('AI_NOT_CONFIGURED');
    const audio = request.audio ?? false;
    const selected = await this.models.selectForEntry(request.userId, audio);
    if (!selected) throw new AiProviderError('AI_NO_ALLOWED_MODEL');
    const model = selected.providerModelId;
    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: AbortSignal.timeout(request.timeoutMs ?? 30000),
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          user: request.userId,
          temperature: 0.2,
          max_tokens: request.maxTokens,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: request.schemaName,
              strict: true,
              schema: request.schema,
            },
          },
          provider: { require_parameters: true },
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.content },
          ],
        }),
      });
    } catch {
      throw new AiProviderError('AI_NETWORK_ERROR');
    }
    if (!response.ok)
      throw new AiProviderError(
        response.status === 429
          ? 'AI_RATE_LIMITED'
          : response.status === 402
            ? 'AI_INSUFFICIENT_CREDITS'
            : response.status === 401 || response.status === 403
              ? 'AI_AUTH_ERROR'
              : 'AI_PROVIDER_ERROR',
      );
    try {
      const payload = (await response.json()) as {
        model?: string;
        choices?: { message?: { content?: string } }[];
      };
      const actual = await this.models.findAllowed(
        request.userId,
        payload.model ?? model,
        audio,
      );
      if (!actual) throw new AiProviderError('AI_UNREGISTERED_MODEL');
      return {
        result: JSON.parse(
          payload.choices?.[0]?.message?.content ?? '',
        ) as unknown,
        providerModelId: actual.providerModelId,
        modelId: actual.id,
      };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      throw new AiProviderError('AI_INVALID_RESPONSE');
    }
  }
}
