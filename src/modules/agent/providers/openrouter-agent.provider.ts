import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenRouter, stepCountIs, maxCost } from '@openrouter/agent';
import type { Item } from '@openrouter/agent';
import { AgentError } from '../domain/agent.types.js';
import type { AgentProvider, AgentRequest } from '../domain/agent.types.js';
/** Replies are capped at ~120 words; the budget also covers tool-call steps. */
const MAX_OUTPUT_TOKENS = 1000;
const MIN_OUTPUT_TOKENS = 300;
interface Attempt {
  model: string;
  maxOutputTokens: number;
  primary: boolean;
  reduced: boolean;
}
@Injectable()
export class OpenRouterAgentProvider implements AgentProvider {
  private readonly logger = new Logger(OpenRouterAgentProvider.name);
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}
  async run(request: AgentRequest) {
    const key = this.config.get<string>('OPENROUTER_API_KEY');
    if (!key) throw new AgentError('AI_NOT_CONFIGURED');
    const client = new OpenRouter({ apiKey: key });
    const attempts: Attempt[] = request.models
      .slice(0, 2)
      .map((model, index) => ({
        model,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        primary: index === 0,
        reduced: false,
      }));
    for (let index = 0; index < attempts.length; index++) {
      const { model, maxOutputTokens, primary } = attempts[index];
      let progressed = false;
      let streamed = false;
      const result = client.callModel(
        {
          model,
          hooks: {
            PreToolUse: [
              {
                handler: () => {
                  progressed = true;
                },
              },
            ],
          },
          instructions: request.instructions,
          input: request.messages.map((message, index): Item =>
            message.role === 'user'
              ? { role: 'user', type: 'message', content: message.content }
              : {
                  role: 'assistant',
                  type: 'message',
                  id: `msg_history_${index}`,
                  status: 'completed',
                  content: [
                    {
                      type: 'output_text',
                      text: message.content,
                      annotations: [],
                    },
                  ],
                },
          ),
          tools: request.tools,
          signal: request.signal,
          provider: { requireParameters: true },
          maxOutputTokens,
          stopWhen: [stepCountIs(5), maxCost(0.1)],
          allowFinalResponse:
            'Answer concisely using only confirmed retrieved facts. If the retrieval limit was reached, mention any missing information.',
        },
        { retries: { strategy: 'none' } },
      );
      try {
        for await (const delta of result.getTextStream()) {
          request.signal.throwIfAborted();
          if (delta) progressed = streamed = true;
          await request.onText(delta);
        }
        const response = await result.getResponse();
        // A reply cut short by the token or step limit is still a usable answer once text has streamed.
        if (
          response.status !== 'completed' &&
          !(response.status === 'incomplete' && streamed)
        )
          throw new AgentError('AI_INCOMPLETE_RESPONSE');
        return {
          providerModelId: response.model,
          usage: await result.getUsage(),
        };
      } catch (error) {
        await result.cancel().catch(() => undefined);
        if (request.signal.aborted) throw request.signal.reason;
        if (error instanceof AgentError) throw error;
        const status =
          typeof error === 'object' && error !== null && 'statusCode' in error
            ? error.statusCode
            : null;
        const name = error instanceof Error ? error.name : 'UnknownError';
        // Transient failures before any output are retried once on the registered fallback model.
        const transient =
          typeof status === 'number'
            ? [404, 408, 429, 500, 502, 503, 504].includes(status)
            : [
                'ConnectionError',
                'RequestTimeoutError',
                'UnexpectedClientError',
              ].includes(name);
        // A spend-limited key rejects requests whose max_tokens it cannot cover; retry once within budget.
        const affordable =
          status === 402 && error instanceof Error
            ? Number(/can only afford (\d+)/.exec(error.message)?.[1])
            : NaN;
        if (
          !progressed &&
          !attempts[index].reduced &&
          affordable >= MIN_OUTPUT_TOKENS
        ) {
          this.logger.warn(
            `OpenRouter key can only afford ${affordable} tokens; retrying with a smaller reply budget`,
          );
          attempts.splice(index + 1, 0, {
            ...attempts[index],
            maxOutputTokens: Math.min(maxOutputTokens, affordable) - 16,
            reduced: true,
          });
          continue;
        }
        if (primary && request.models.length > 1 && !progressed && transient) {
          this.logger.warn(
            'OpenRouter primary unavailable; trying registered fallback',
          );
          continue;
        }
        const code =
          status === 404
            ? 'MODEL_UNAVAILABLE'
            : status === 429
              ? 'AI_RATE_LIMITED'
              : status === 402
                ? 'AI_INSUFFICIENT_CREDITS'
                : status === 401 || status === 403
                  ? 'AI_AUTH_ERROR'
                  : 'AI_PROVIDER_ERROR';
        this.logger.warn(
          `OpenRouter agent failed (${code}, ${name}, status ${String(status)}): ${error instanceof Error ? error.message : String(error)}`,
        );
        const errorType = [
          'SDKError',
          'SDKValidationError',
          'UnexpectedClientError',
          'ConnectionError',
          'ResponseValidationError',
          'NotFoundResponseError',
          'Error',
          'TypeError',
        ].includes(name)
          ? name
          : 'UnknownError';
        throw new AgentError(code, {
          errorType,
          httpStatus: typeof status === 'number' ? status : null,
        });
      }
    }
    throw new AgentError('MODEL_UNAVAILABLE');
  }
}
