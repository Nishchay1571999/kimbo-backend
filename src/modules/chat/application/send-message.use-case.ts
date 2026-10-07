import { Inject, Injectable, Logger } from '@nestjs/common';
import type { UserIdentity } from '../../../common/identity/current-user.js';
import { localDate } from '../../../common/time/calendar.js';
import { ChatRepository } from '../infrastructure/chat.repository.js';
import type { ChatSource, EmitChatEvent } from '../domain/chat.types.js';
import { AgentRunner } from '../../agent/agent-runner.js';
import { AgentError } from '../../agent/domain/agent.types.js';
import { SourceCollector } from '../../agent/sources/source-collector.js';
export type StartedMessage = Awaited<ReturnType<ChatRepository['begin']>>;
@Injectable()
export class SendMessageUseCase {
  private readonly logger = new Logger(SendMessageUseCase.name);
  constructor(
    @Inject(ChatRepository) private readonly chats: ChatRepository,
    @Inject(AgentRunner) private readonly agent: AgentRunner,
  ) {}
  begin(userId: string, threadId: string, requestId: string, message: string) {
    return this.chats.begin(userId, threadId, requestId, message);
  }
  async execute(
    user: UserIdentity,
    started: StartedMessage,
    emit: EmitChatEvent,
    signal: AbortSignal,
  ) {
    const { assistant, userMessage, thread, replayed } = started;
    const startedEvent = {
      type: 'message.started' as const,
      messageId: assistant.id,
      userMessageId: userMessage.id,
      requestId: assistant.requestId,
      replayed,
    };
    if (replayed) {
      await emit(startedEvent);
      const metadata = assistant.metadata as { sources?: ChatSource[] };
      for (const source of metadata.sources ?? [])
        await emit({ type: 'source.added', source });
      if (assistant.message)
        await emit({ type: 'text.delta', delta: assistant.message });
      if (assistant.status === 'completed')
        await emit({
          type: 'message.completed',
          messageId: assistant.id,
          actualModelId: assistant.actualModelId,
          replayed: true,
        });
      else
        await emit({
          type:
            assistant.status === 'cancelled'
              ? 'message.cancelled'
              : 'message.failed',
          messageId: assistant.id,
          errorCode: assistant.errorCode ?? 'AI_PROVIDER_ERROR',
        });
      return;
    }
    let content = '';
    const sources = new SourceCollector(emit);
    let actualModelId: string | null = null;
    try {
      await emit(startedEvent);
      signal.throwIfAborted();
      await emit({ type: 'agent.status', status: 'thinking' });
      const result = await this.agent.run(
        {
          userId: user.userId,
          timezone: user.timezone,
          threadId: thread.id,
          assistantMessageId: assistant.id,
          requestId: assistant.requestId,
          currentLocalDate: localDate(new Date(), user.timezone),
          signal,
          emit,
          sources,
        },
        thread.aiModelId,
        userMessage.sequenceNumber,
        userMessage.message,
        async (delta) => {
          signal.throwIfAborted();
          if (!content)
            await emit({ type: 'agent.status', status: 'generating' });
          content += delta;
          if (content.length > 30_000) throw new AgentError('AI_OUTPUT_LIMIT');
          await emit({ type: 'text.delta', delta });
        },
      );
      actualModelId = result.actualModelId;
      signal.throwIfAborted();
      if (!content.trim()) throw new AgentError('AI_EMPTY_RESPONSE');
      await this.chats.finish(assistant.id, {
        status: 'completed',
        message: content,
        actualModelId,
        metadata: {
          ...sources.metadata(),
          providerModelId: result.providerModelId,
          usage: result.usage,
        },
      });
    } catch (error) {
      const cause = signal.aborted ? signal.reason : error;
      const errorCode =
        cause instanceof AgentError ? cause.code : 'AI_PROVIDER_ERROR';
      // Unexpected exceptions (context, tools, persistence) were previously indistinguishable from provider failures.
      if (!(cause instanceof AgentError))
        this.logger.error(
          `Chat reply failed: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`,
          cause instanceof Error ? cause.stack : undefined,
        );
      const diagnostic =
        cause instanceof AgentError
          ? cause.diagnostic
          : {
              errorType: cause instanceof Error ? cause.name : 'UnknownError',
              httpStatus: null,
            };
      const status = errorCode === 'CANCELLED' ? 'cancelled' : 'failed';
      try {
        await this.chats.finish(assistant.id, {
          status,
          message: content,
          actualModelId,
          metadata: diagnostic
            ? { ...sources.metadata(), diagnostic }
            : sources.metadata(),
          errorCode,
        });
      } catch {
        this.logger.error(
          `Chat result could not be persisted: ${assistant.id}`,
        );
        await emit({
          type: 'message.failed',
          messageId: assistant.id,
          errorCode: 'CHAT_PERSISTENCE_ERROR',
        });
        return;
      }
      await emit({
        type: status === 'cancelled' ? 'message.cancelled' : 'message.failed',
        messageId: assistant.id,
        errorCode,
      });
      return;
    }
    // A committed completion is authoritative, even if the connection closes
    // while delivering its final event. A retry replays that saved response.
    await emit({
      type: 'message.completed',
      messageId: assistant.id,
      actualModelId,
    });
  }
}
