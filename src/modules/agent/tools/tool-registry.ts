import { Inject, Injectable } from '@nestjs/common';
import { tool } from '@openrouter/agent';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  HealthProjectionService,
  healthPeriod,
  weekPeriod,
  monthPeriod,
} from '../../health/application/health-projection.service.js';
import { HealthHistoryRepository } from '../../health/infrastructure/health-history.repository.js';
import type { AgentRunContext } from '../domain/agent.types.js';
import type { ChatSource } from '../../chat/domain/chat.types.js';
const date = z.iso.date();
const anchor = z.object({ anchorDate: date.optional() }).strict();
const range = z.object({ from: date, to: date }).strict();
type Retrieval = {
  modelData: unknown;
  snapshot: unknown;
  provenance: ChatSource['provenance'];
};
@Injectable()
export class ToolRegistry {
  constructor(
    @Inject(HealthProjectionService)
    private readonly health: HealthProjectionService,
    @Inject(HealthHistoryRepository)
    private readonly history: HealthHistoryRepository,
  ) {}
  createFor(context: AgentRunContext) {
    const execute = async (
      name: string,
      type: ChatSource['type'],
      label: string,
      query: unknown,
      retrieve: () => Promise<Retrieval>,
      id: string = randomUUID(),
    ) => {
      context.signal.throwIfAborted();
      if (context.sources.toolCalls.length >= 12)
        return {
          error: 'TOOL_LIMIT',
          message: 'Retrieval limit reached; answer using available facts.',
        };
      const call = {
        id,
        name,
        status: 'processing' as 'processing' | 'completed' | 'failed',
      };
      context.sources.toolCalls.push(call);
      await context.emit({
        type: 'tool.started',
        toolCallId: id,
        tool: name,
        label,
      });
      try {
        const result = await retrieve();
        context.signal.throwIfAborted();
        if (Buffer.byteLength(JSON.stringify(result.modelData)) > 64_000)
          throw new Error('Tool result too large');
        const sourceId = await context.sources.add({
          type,
          title: label.replace('Checking ', ''),
          origin: 'tool',
          toolCallId: id,
          query,
          snapshot: result.snapshot,
          provenance: result.provenance,
        });
        call.status = 'completed';
        await context.emit({
          type: 'tool.completed',
          toolCallId: id,
          tool: name,
        });
        return { sourceId, data: result.modelData };
      } catch {
        call.status = 'failed';
        await context.emit({
          type: 'tool.failed',
          toolCallId: id,
          tool: name,
          errorCode: 'TOOL_FAILURE',
        });
        context.signal.throwIfAborted();
        return {
          error: 'TOOL_FAILURE',
          message:
            'Data unavailable. Do not invent values. Try a narrower date range if needed.',
        };
      }
    };
    // No tool schema includes userId: the authenticated identity is closed over.
    return [
      tool({
        name: 'get_day_health',
        description:
          'Retrieve confirmed health facts for a local reporting date, including yesterday or a specific day.',
        inputSchema: z.object({ date }).strict(),
        execute: (input, ctx) =>
          execute(
            'get_day_health',
            'daily_health',
            `Checking health on ${input.date}`,
            input,
            () => this.health.day(context.userId, input.date),
            ctx?.toolCall?.callId,
          ),
      }),
      tool({
        name: 'get_week_health',
        description:
          'Retrieve the Monday–Sunday calendar week containing anchorDate. Defaults to the current local week. Includes backend averages excluding days without nutrition logs.',
        inputSchema: anchor,
        execute: (input, ctx) =>
          execute(
            'get_week_health',
            'weekly_health',
            'Checking weekly health',
            input,
            () => {
              const period = weekPeriod(
                input.anchorDate ?? context.currentLocalDate,
              );
              return this.health.range(context.userId, period.from, period.to);
            },
            ctx?.toolCall?.callId,
          ),
      }),
      tool({
        name: 'get_month_health',
        description:
          'Retrieve the calendar month containing anchorDate. Defaults to the current local month. Future and missing dates have no recorded intake.',
        inputSchema: anchor,
        execute: (input, ctx) =>
          execute(
            'get_month_health',
            'monthly_health',
            'Checking monthly health',
            input,
            () => {
              const period = monthPeriod(
                input.anchorDate ?? context.currentLocalDate,
              );
              return this.health.range(context.userId, period.from, period.to);
            },
            ctx?.toolCall?.callId,
          ),
      }),
      tool({
        name: 'get_health_range',
        description:
          'Retrieve aggregate health facts for an inclusive local date range of at most 93 days, including rolling seven-day periods.',
        inputSchema: range,
        execute: (input, ctx) =>
          execute(
            'get_health_range',
            'health_range',
            'Checking health history',
            input,
            () => this.health.range(context.userId, input.from, input.to),
            ctx?.toolCall?.callId,
          ),
      }),
      tool({
        name: 'get_entries',
        description:
          'Drill into saved meals, exercises or notes over an inclusive range. Use after identifying a high-intake day. Maximum 50 results; truncated results are flagged.',
        inputSchema: range
          .extend({
            category: z.enum(['nutrition', 'exercise', 'note']).optional(),
            limit: z.number().int().min(1).max(50).default(50),
          })
          .strict(),
        execute: (input, ctx) =>
          execute(
            'get_entries',
            'entries',
            'Checking saved entries',
            input,
            () =>
              this.health.getEntries(
                context.userId,
                input.from,
                input.to,
                input.category,
                input.limit,
              ),
            ctx?.toolCall?.callId,
          ),
      }),
      tool({
        name: 'get_health_metric_history',
        description:
          'Retrieve active weight measurements in kilograms for an inclusive local date range of at most 93 days. Superseded, void and deleted-entry measurements are excluded.',
        inputSchema: range.extend({ metric: z.literal('weight') }).strict(),
        execute: (input, ctx) =>
          execute(
            'get_health_metric_history',
            'metric_history',
            'Checking weight history',
            input,
            () => {
              healthPeriod(input.from, input.to);
              return this.history.weightHistory(
                context.userId,
                input.from,
                input.to,
                context.timezone,
              );
            },
            ctx?.toolCall?.callId,
          ),
      }),
    ] as const;
  }
}
