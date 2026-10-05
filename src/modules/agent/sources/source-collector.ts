import { randomUUID } from 'node:crypto';
import type {
  ChatSource,
  EmitChatEvent,
  ToolCallSummary,
} from '../../chat/domain/chat.types.js';
import { AgentError } from '../domain/agent.types.js';
export class SourceCollector {
  readonly sources: ChatSource[] = [];
  readonly toolCalls: ToolCallSummary[] = [];
  private bytes = 0;
  constructor(private readonly emit: EmitChatEvent) {}
  async add(input: Omit<ChatSource, 'id'>) {
    const source = { id: randomUUID(), ...input };
    const size = Buffer.byteLength(JSON.stringify(source));
    if (this.sources.length >= 12 || this.bytes + size > 256_000)
      throw new AgentError('SOURCE_LIMIT');
    this.bytes += size;
    this.sources.push(source);
    await this.emit({ type: 'source.added', source });
    return source.id;
  }
  metadata() {
    return {
      agent: { version: 1, toolCalls: this.toolCalls },
      sources: this.sources,
    };
  }
}
