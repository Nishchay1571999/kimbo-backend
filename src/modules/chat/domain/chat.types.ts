export interface ChatSource {
  id: string;
  type:
    | 'daily_health'
    | 'weekly_health'
    | 'monthly_health'
    | 'health_range'
    | 'entries'
    | 'metric_history';
  title: string;
  origin: 'context' | 'tool';
  toolCallId?: string;
  query: unknown;
  snapshot: unknown;
  provenance: {
    entities: { entityId: string; revision: number }[];
    healthRecordIds: string[];
  };
}
export interface ToolCallSummary {
  id: string;
  name: string;
  status: 'processing' | 'completed' | 'failed';
}
export type ChatEvent =
  | {
      type: 'message.started';
      messageId: string;
      userMessageId: string;
      requestId: string;
      replayed: boolean;
    }
  | { type: 'agent.status'; status: 'thinking' | 'generating' }
  | { type: 'tool.started'; toolCallId: string; tool: string; label: string }
  | { type: 'tool.completed'; toolCallId: string; tool: string }
  | { type: 'tool.failed'; toolCallId: string; tool: string; errorCode: string }
  | { type: 'source.added'; source: ChatSource }
  | { type: 'text.delta'; delta: string }
  | {
      type: 'message.completed';
      messageId: string;
      actualModelId: string | null;
      replayed?: boolean;
    }
  | {
      type: 'message.failed' | 'message.cancelled';
      messageId: string;
      errorCode: string;
    };
export type EmitChatEvent = (event: ChatEvent) => Promise<void>;
