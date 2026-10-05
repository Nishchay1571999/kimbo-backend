import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_MODEL_REPOSITORY } from '../ai/domain/ai-model.repository.js';
import type { AiModelRepository } from '../ai/domain/ai-model.repository.js';
import { AGENT_PROVIDER, AgentError } from './domain/agent.types.js';
import type { AgentProvider, AgentRunContext } from './domain/agent.types.js';
import { ContextBuilder } from './context/context-builder.js';
import { ToolRegistry } from './tools/tool-registry.js';
@Injectable()
export class AgentRunner {
  constructor(
    @Inject(ContextBuilder) private readonly builder: ContextBuilder,
    @Inject(ToolRegistry) private readonly tools: ToolRegistry,
    @Inject(AGENT_PROVIDER) private readonly provider: AgentProvider,
    @Inject(AI_MODEL_REPOSITORY) private readonly models: AiModelRepository,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}
  async run(
    context: AgentRunContext,
    modelId: string,
    sequence: number,
    message: string,
    onText: (delta: string) => Promise<void>,
  ) {
    const model = await this.models.findForChat(modelId);
    if (!model) throw new AgentError('MODEL_UNAVAILABLE');
    const fallbackId =
      this.config.get<string>('CHAT_FALLBACK_MODEL') ?? 'openai/gpt-5.4-mini';
    const fallback = fallbackId
      ? await this.models.findForChat(fallbackId)
      : null;
    const built = await this.builder.build(context, sequence, message);
    context.signal.throwIfAborted();
    const result = await this.provider.run({
      ...built,
      tools: this.tools.createFor(context),
      models: [
        model.providerModelId,
        ...(fallback && fallback.id !== model.id
          ? [fallback.providerModelId]
          : []),
      ],
      signal: context.signal,
      onText,
    });
    const actual = await this.models.findForChat(result.providerModelId);
    if (!actual || ![model.id, fallback?.id].includes(actual.id))
      throw new AgentError('AI_UNREGISTERED_MODEL');
    return {
      actualModelId: actual.id,
      providerModelId: actual.providerModelId,
      usage: result.usage,
    };
  }
}
