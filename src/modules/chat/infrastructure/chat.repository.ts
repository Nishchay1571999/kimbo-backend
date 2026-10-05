import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { AI_MODEL_REPOSITORY } from '../../ai/domain/ai-model.repository.js';
import type { AiModelRepository } from '../../ai/domain/ai-model.repository.js';

const threadSelect = {
  id: true,
  title: true,
  aiModelId: true,
  threadStatus: true,
  createdAt: true,
  updatedAt: true,
};
function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
@Injectable()
export class ChatRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AI_MODEL_REPOSITORY) private readonly models: AiModelRepository,
  ) {}
  async create(userId: string, title?: string, aiModelId?: string) {
    const model = aiModelId
      ? await this.models.findForChat(aiModelId)
      : await this.models.selectForChat(userId);
    if (!model)
      throw new ServiceUnavailableException('No enabled chat model available');
    return this.prisma.client.chatThread.create({
      data: { userId, aiModelId: model.id, title: title ?? null },
      select: threadSelect,
    });
  }
  async list(userId: string, limit: number, cursor?: string) {
    if (cursor) await this.get(userId, cursor);
    return this.prisma.client.chatThread.findMany({
      where: { userId, deletedAt: null },
      select: threadSelect,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }
  async get(userId: string, id: string) {
    const thread = await this.prisma.client.chatThread.findFirst({
      where: { id, userId, deletedAt: null },
      select: threadSelect,
    });
    if (!thread) throw new NotFoundException('Thread not found');
    return thread;
  }
  async update(
    userId: string,
    id: string,
    input: {
      title?: string;
      aiModelId?: string;
      threadStatus?: 'active' | 'archived';
    },
  ) {
    if (input.aiModelId && !(await this.models.findForChat(input.aiModelId)))
      throw new BadRequestException('Model is not enabled for chat');
    return this.prisma.client.$transaction(async (tx) => {
      const rows =
        await tx.$queryRaw`SELECT id FROM chat_threads WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL FOR UPDATE`;
      if (!Array.isArray(rows) || !rows.length)
        throw new NotFoundException('Thread not found');
      if (
        await tx.chatMessage.findFirst({
          where: {
            threadId: id,
            role: 'assistant',
            status: { in: ['pending', 'processing'] },
          },
        })
      )
        throw new ConflictException('THREAD_BUSY');
      return tx.chatThread.update({
        where: { id },
        data: input,
        select: threadSelect,
      });
    });
  }
  async delete(userId: string, id: string) {
    await this.prisma.client.$transaction(async (tx) => {
      const rows =
        await tx.$queryRaw`SELECT id FROM chat_threads WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL FOR UPDATE`;
      if (!Array.isArray(rows) || !rows.length)
        throw new NotFoundException('Thread not found');
      if (
        await tx.chatMessage.findFirst({
          where: {
            threadId: id,
            role: 'assistant',
            status: { in: ['pending', 'processing'] },
          },
        })
      )
        throw new ConflictException('THREAD_BUSY');
      await tx.chatThread.update({
        where: { id },
        data: { deletedAt: new Date(), threadStatus: 'deleted' },
      });
    });
  }
  async messages(
    userId: string,
    threadId: string,
    limit = 50,
    before?: number,
  ) {
    await this.get(userId, threadId);
    const rows = await this.prisma.client.chatMessage.findMany({
      where: {
        threadId,
        ...(before ? { sequenceNumber: { lt: before } } : {}),
      },
      orderBy: { sequenceNumber: 'desc' },
      take: limit,
    });
    return rows.reverse();
  }
  async begin(
    userId: string,
    threadId: string,
    requestId: string,
    message: string,
  ) {
    return this.prisma.client.$transaction(
      async (tx) => {
        const locked =
          await tx.$queryRaw`SELECT id FROM chat_threads WHERE id = ${threadId}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL FOR UPDATE`;
        if (!Array.isArray(locked) || !locked.length)
          throw new NotFoundException('Thread not found');
        const thread = await tx.chatThread.findUniqueOrThrow({
          where: { id: threadId },
        });
        const previous = await tx.chatMessage.findMany({
          where: { threadId, requestId },
          orderBy: { sequenceNumber: 'asc' },
        });
        if (previous.length) {
          const userMessage = previous.find((row) => row.role === 'user');
          const assistant = previous.find((row) => row.role === 'assistant');
          if (!userMessage || !assistant || userMessage.message !== message)
            throw new ConflictException('REQUEST_ID_REUSED');
          if (
            assistant.status === 'pending' ||
            assistant.status === 'processing'
          ) {
            if (assistant.createdAt.getTime() > Date.now() - 300_000)
              throw new ConflictException('MESSAGE_IN_PROGRESS');
            const failed = await tx.chatMessage.update({
              where: { id: assistant.id },
              data: {
                status: 'failed',
                errorCode: 'AI_TIMEOUT',
                completedAt: new Date(),
              },
            });
            return { thread, userMessage, assistant: failed, replayed: true };
          }
          return { thread, userMessage, assistant, replayed: true };
        }
        if (thread.threadStatus !== 'active')
          throw new ConflictException('THREAD_ARCHIVED');
        // Recover abandoned runs after process termination. Active requests have
        // a shorter timeout, and this update is serialized by the thread lock.
        await tx.chatMessage.updateMany({
          where: {
            threadId,
            role: 'assistant',
            status: { in: ['pending', 'processing'] },
            createdAt: { lt: new Date(Date.now() - 300_000) },
          },
          data: {
            status: 'failed',
            errorCode: 'AI_TIMEOUT',
            completedAt: new Date(),
          },
        });
        if (
          await tx.chatMessage.findFirst({
            where: {
              threadId,
              role: 'assistant',
              status: { in: ['pending', 'processing'] },
            },
          })
        )
          throw new ConflictException('THREAD_BUSY');
        const last = await tx.chatMessage.findFirst({
          where: { threadId },
          select: { sequenceNumber: true },
          orderBy: { sequenceNumber: 'desc' },
        });
        const sequence = (last?.sequenceNumber ?? 0) + 1;
        const userMessage = await tx.chatMessage.create({
          data: {
            threadId,
            requestId,
            role: 'user',
            status: 'completed',
            message,
            sequenceNumber: sequence,
            completedAt: new Date(),
          },
        });
        const assistant = await tx.chatMessage.create({
          data: {
            threadId,
            requestId,
            role: 'assistant',
            status: 'processing',
            sequenceNumber: sequence + 1,
            replyToMessageId: userMessage.id,
          },
        });
        await tx.chatThread.update({
          where: { id: threadId },
          data: {
            updatedAt: new Date(),
            ...(thread.title === null ? { title: message.slice(0, 100) } : {}),
          },
        });
        return { thread, userMessage, assistant, replayed: false };
      },
      { timeout: 20_000 },
    );
  }
  async conversation(threadId: string, before: number) {
    const rows = await this.prisma.client.chatMessage.findMany({
      where: { threadId, sequenceNumber: { lt: before }, status: 'completed' },
      select: { role: true, message: true },
      orderBy: { sequenceNumber: 'desc' },
      take: 20,
    });
    let remaining = 24_000;
    const messages: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const row of rows) {
      const content = row.message.slice(0, Math.min(remaining, 8000));
      if (!content) break;
      messages.push({ role: row.role, content });
      remaining -= content.length;
    }
    return messages.reverse();
  }
  async finish(
    id: string,
    input: {
      status: 'completed' | 'failed' | 'cancelled';
      message: string;
      actualModelId: string | null;
      metadata: unknown;
      errorCode?: string;
    },
  ) {
    await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.chatMessage.update({
        where: { id },
        data: {
          ...input,
          metadata: json(input.metadata),
          completedAt: new Date(),
        },
      });
      await tx.chatThread.update({
        where: { id: row.threadId },
        data: { updatedAt: new Date() },
      });
    });
  }
}
