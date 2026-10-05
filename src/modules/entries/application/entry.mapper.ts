import type { Prisma } from '../../../generated/prisma/client.js';
import { mealCalories } from '../domain/entry.types.js';
import type {
  Attachment,
  Entry,
  EntryData,
  NutritionData,
} from '../domain/entry.types.js';
type EntryRow = Prisma.EntityGetPayload<{ include: { details: true } }>;
export function toEntryDto(row: EntryRow): Entry {
  const data = row.details.tagData as unknown as EntryData;
  return {
    id: row.entityId,
    category: row.tag,
    title: row.details.title,
    entryDate: row.entryDate.toISOString().slice(0, 10),
    occurredAt: row.occurredAt.toISOString(),
    recordedTimezone: row.recordedTimezone,
    inputSource: row.inputSource,
    note: row.details.note,
    attachments: row.entityAttachments as unknown as Attachment[],
    data,
    summary: {
      caloriesKcal:
        row.tag === 'nutrition' ? mealCalories(data as NutritionData) : null,
    },
    ai: {
      status: row.details.aiStatus,
      errorCode: row.details.aiErrorCode,
      synopsis:
        row.details.aiStatus === 'completed' &&
        row.details.aiInputRevision === row.revision
          ? row.details.aiSynopsis
          : null,
    },
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
