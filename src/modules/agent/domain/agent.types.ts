import type { Tool } from '@openrouter/agent';
import type { EmitChatEvent } from '../../chat/domain/chat.types.js';
import type { SourceCollector } from '../sources/source-collector.js';
export const AGENT_PROVIDER = Symbol('AGENT_PROVIDER');
export interface AgentRequest {
  instructions: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  models: string[];
  tools: readonly Tool[];
  signal: AbortSignal;
  onText: (delta: string) => Promise<void>;
}
export interface AgentProvider {
  run(
    request: AgentRequest,
  ): Promise<{ providerModelId: string; usage: unknown }>;
}
export interface AgentRunContext {
  userId: string;
  threadId: string;
  assistantMessageId: string;
  requestId: string;
  timezone: string;
  currentLocalDate: string;
  signal: AbortSignal;
  emit: EmitChatEvent;
  sources: SourceCollector;
}
export class AgentError extends Error {
  constructor(
    readonly code: string,
    readonly diagnostic?: { errorType: string; httpStatus: number | null },
  ) {
    super(code);
  }
}
