import {
  ConflictException,
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import type { EntryRepository } from '../domain/entry.repository.js';
import type { EntryContent } from '../domain/entry.types.js';
import { toEntryDto } from '../application/entry.mapper.js';
function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
function entityFields(content: EntryContent) {
  return {
    tag: content.category,
    entryDate: new Date(content.entryDate),
    occurredAt: new Date(content.occurredAt),
    recordedTimezone: content.recordedTimezone,
    inputSource: content.inputSource,
    entityAttachments: json(content.attachments),
  };
}
const resetAi = {
  aiStatus: 'pending' as const,
  aiSynopsis: null,
  aiStructuredData: Prisma.DbNull,
  aiInputRevision: null,
  aiAttemptCount: 0,
  aiNextAttemptAt: new Date(0),
  aiLockedUntil: null,
  aiErrorCode: null,
  aiCompletedAt: null,
  aiModelId: null,
  aiPipelineVersion: null,
};
@Injectable()
export class PrismaEntryRepository implements EntryRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async create(userId: string, content: EntryContent) {
    // Nested writes are one transaction: the required details row cannot be orphaned.
    return toEntryDto(
      await this.prisma.client.entity.create({
        data: {
          user: { connect: { id: userId } },
          ...entityFields(content),
          details: {
            create: {
              title: content.title,
              note: content.note,
              tagData: json(content.data),
              ...resetAi,
            },
          },
        },
        include: { details: true },
      }),
    );
  }
  async get(userId: string, id: string) {
    const row = await this.prisma.client.entity.findFirst({
      where: { entityId: id, userId, deletedAt: null },
      include: { details: true },
    });
    return row ? toEntryDto(row) : null;
  }
  async list(userId: string, date: string) {
    return (
      await this.prisma.client.entity.findMany({
        where: { userId, entryDate: new Date(date), deletedAt: null },
        include: { details: true },
        orderBy: [{ occurredAt: 'asc' }, { entityId: 'asc' }],
      })
    ).map(toEntryDto);
  }
  async update(
    userId: string,
    id: string,
    content: EntryContent,
    revision: number,
  ) {
    return this.prisma.client.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { entity_id: string }[]
      >`SELECT entity_id FROM entities WHERE entity_id = ${id}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL FOR UPDATE`;
      if (!rows.length) throw new NotFoundException('Entry not found');
      const current = await tx.entity.findUniqueOrThrow({
        where: { entityId: id },
        include: { details: true },
      });
      if (current.revision !== revision)
        throw new ConflictException('Entry changed; reload before editing');
      await tx.entity.update({
        where: { entityId: id },
        data: entityFields(content),
      });
      await tx.entityTagDetails.update({
        where: { id: current.entityTagDetailsId },
        data: {
          title: content.title,
          note: content.note,
          tagData: json(content.data),
          ...resetAi,
        },
      });
      // SQL owns revision increments. A multi-field edit may advance more than once.
      return toEntryDto(
        await tx.entity.findUniqueOrThrow({
          where: { entityId: id },
          include: { details: true },
        }),
      );
    });
  }
  async listRange(userId: string, from: string, to: string) {
    const rows = await this.prisma.client.entity.findMany({
      where: {
        userId,
        deletedAt: null,
        entryDate: { gte: new Date(from), lte: new Date(to) },
      },
      include: { details: true },
      orderBy: [
        { entryDate: 'asc' },
        { occurredAt: 'asc' },
        { entityId: 'asc' },
      ],
      take: 1001,
    });
    if (rows.length > 1000)
      throw new BadRequestException(
        'Too many entries; retrieve a shorter period',
      );
    return rows.map(toEntryDto);
  }
  async delete(userId: string, id: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { entity_id: string }[]
      >`SELECT entity_id FROM entities WHERE entity_id = ${id}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL FOR UPDATE`;
      if (!rows.length) throw new NotFoundException('Entry not found');
      const row = await tx.entity.update({
        where: { entityId: id },
        data: { deletedAt: new Date() },
      });
      await tx.entityTagDetails.update({
        where: { id: row.entityTagDetailsId },
        data: {
          aiStatus: 'not_requested',
          aiSynopsis: null,
          aiStructuredData: Prisma.DbNull,
          aiLockedUntil: null,
          aiNextAttemptAt: null,
        },
      });
    });
  }
}
