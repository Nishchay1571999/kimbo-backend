import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { toEntryDto } from '../../entries/application/entry.mapper.js';
import type { AiAnalysis } from '../domain/ai-provider.js';
import type {
  AnalysisWork,
  AnalysisWorkRepository,
} from '../domain/analysis-work.repository.js';
const MAX_ATTEMPTS = 3;
@Injectable()
export class PrismaAnalysisWorkRepository implements AnalysisWorkRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async claim(userId?: string, entryId?: string): Promise<AnalysisWork | null> {
    if (entryId && !userId)
      throw new Error('Scoped claims require user identity');
    return this.prisma.client.$transaction(async (tx) => {
      // All mutations take the entity lock first, then details: same ordering as edits.
      const rows = await tx.$queryRaw<{ entity_id: string }[]>`
       SELECT e.entity_id FROM entities e JOIN entity_tag_details d ON d.id = e.entity_tag_details_id
       WHERE e.deleted_at IS NULL
       AND (${userId ?? null}::uuid IS NULL OR e.user_id = ${userId ?? null}::uuid)
       AND (${entryId ?? null}::uuid IS NULL OR e.entity_id = ${entryId ?? null}::uuid)
       AND (
         (d.ai_status = 'pending' AND (d.ai_next_attempt_at IS NULL OR d.ai_next_attempt_at <= CURRENT_TIMESTAMP)) OR
         (d.ai_status = 'processing' AND (d.ai_locked_until IS NULL OR d.ai_locked_until <= CURRENT_TIMESTAMP)))
       ORDER BY d.ai_next_attempt_at NULLS FIRST, e.entity_id FOR UPDATE OF e SKIP LOCKED LIMIT 1`;
      if (!rows.length) return null;
      const row = await tx.entity.findUniqueOrThrow({
        where: { entityId: rows[0].entity_id },
        include: { details: true },
      });
      if (row.details.aiAttemptCount >= MAX_ATTEMPTS) {
        await tx.entityTagDetails.update({
          where: { id: row.details.id },
          data: {
            aiStatus: 'failed',
            aiErrorCode: 'AI_RETRY_LIMIT',
            aiLockedUntil: null,
            aiNextAttemptAt: null,
          },
        });
        return null;
      }
      const lockedUntil = new Date(Date.now() + 60000);
      const details = await tx.entityTagDetails.update({
        where: { id: row.details.id },
        data: {
          aiStatus: 'processing',
          aiInputRevision: row.revision,
          aiAttemptCount: { increment: 1 },
          aiLockedUntil: lockedUntil,
          aiNextAttemptAt: null,
        },
      });
      return {
        userId: row.userId,
        entry: toEntryDto({ ...row, details }),
        detailsId: row.details.id,
        revision: row.revision,
        attempt: details.aiAttemptCount,
        lockedUntil,
      };
    });
  }
  private async isCurrent(
    tx: Prisma.TransactionClient,
    userId: string,
    work: AnalysisWork,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<
      { entity_id: string }[]
    >`SELECT entity_id FROM entities WHERE entity_id = ${work.entry.id}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL FOR UPDATE`;
    if (!rows.length) return false;
    const row = await tx.entity.findUniqueOrThrow({
      where: { entityId: work.entry.id },
      include: { details: true },
    });
    return (
      row.revision === work.revision &&
      row.details.aiInputRevision === work.revision &&
      row.details.aiStatus === 'processing' &&
      row.details.aiLockedUntil?.getTime() === work.lockedUntil.getTime() &&
      row.details.aiLockedUntil.getTime() > Date.now()
    );
  }
  async complete(
    userId: string,
    work: AnalysisWork,
    output: AiAnalysis,
  ): Promise<boolean> {
    return this.prisma.client.$transaction(async (tx) => {
      if (!(await this.isCurrent(tx, userId, work))) return false;
      const model = await tx.aiModel.findFirst({
        where: {
          id: output.modelId,
          provider: 'openrouter',
          providerModelId: output.providerModelId,
          isAvailable: true,
          supportsText: true,
          supportsImages: true,
          ...(work.entry.attachments.some((a) => a.type === 'audio')
            ? { supportsAudio: true }
            : {}),
        },
        select: { id: true },
      });
      if (!model) throw new Error('AI model is not registered and available');
      await tx.entityTagDetails.update({
        where: { id: work.detailsId },
        data: {
          aiStatus: 'completed',
          aiSynopsis: output.synopsis,
          aiStructuredData: output.structured,
          aiModelId: model.id,
          aiPipelineVersion: 'entry-synopsis-v1',
          aiCompletedAt: new Date(),
          aiErrorCode: null,
          aiLockedUntil: null,
          aiNextAttemptAt: null,
        },
      });
      return true;
    });
  }
  async fail(userId: string, work: AnalysisWork, code: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      if (!(await this.isCurrent(tx, userId, work))) return;
      const exhausted = work.attempt >= MAX_ATTEMPTS;
      await tx.entityTagDetails.update({
        where: { id: work.detailsId },
        data: {
          aiStatus: exhausted ? 'failed' : 'pending',
          aiErrorCode: code,
          aiLockedUntil: null,
          aiNextAttemptAt: exhausted
            ? null
            : new Date(Date.now() + 10000 * 2 ** (work.attempt - 1)),
        },
      });
    });
  }
}
