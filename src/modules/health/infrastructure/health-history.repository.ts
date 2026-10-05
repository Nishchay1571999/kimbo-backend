import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { localDate } from '../../../common/time/calendar.js';
import { healthPeriod } from '../application/health-projection.service.js';
type WeightObservation = {
  id: string;
  value: Prisma.Decimal;
  occurredAt: Date;
  sourceEntityId: string | null;
  sourceRevision: number | null;
};
function activeWeight(userId: string) {
  return Prisma.sql`r.user_id = ${userId}::uuid AND r.metric_type = 'weight' AND NOT r.is_void
    AND NOT EXISTS (SELECT 1 FROM health_records s WHERE s.supersedes_record_id = r.id)
    AND (r.source_entity_id IS NULL OR (e.user_id = r.user_id AND e.deleted_at IS NULL AND e.revision = r.source_revision))`;
}
@Injectable()
export class HealthHistoryRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async profile(userId: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { timezone: true, healthProfile: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const [weight] = await this.prisma.client.$queryRaw<
      WeightObservation[]
    >(Prisma.sql`
      SELECT r.id, r.value, r.occurred_at AS "occurredAt"
      FROM health_records r LEFT JOIN entities e ON e.entity_id = r.source_entity_id
      WHERE ${activeWeight(userId)} AND r.occurred_at <= NOW()
      ORDER BY r.occurred_at DESC, r.created_at DESC, r.id DESC LIMIT 1`);
    const profile = user.healthProfile;
    return {
      timezone: user.timezone,
      profile: profile
        ? {
            heightCm: Number(profile.heightCm),
            ageAtOnboarding: profile.ageAtOnboarding,
            ageRecordedOn: profile.ageRecordedOn.toISOString().slice(0, 10),
            gender: profile.gender,
            goalIntention: profile.goalIntention,
            exerciseFrequency: profile.exerciseFrequency,
            healthyEatingFrequency: profile.healthyEatingFrequency,
          }
        : null,
      currentWeight: weight
        ? {
            recordId: weight.id,
            valueKg: Number(weight.value),
            occurredAt: weight.occurredAt.toISOString(),
          }
        : null,
      schedule: {
        wake: profile?.defaultWakeTime.toISOString().slice(11, 16) ?? null,
        sleep: profile?.defaultSleepTime.toISOString().slice(11, 16) ?? null,
      },
    };
  }
  async weightHistory(
    userId: string,
    from: string,
    to: string,
    timezone: string,
  ) {
    healthPeriod(from, to);
    // Buffer UTC bounds, then apply local reporting dates: no DST assumptions.
    const rows = await this.prisma.client.$queryRaw<
      WeightObservation[]
    >(Prisma.sql`
      SELECT r.id, r.value, r.occurred_at AS "occurredAt", r.source_entity_id AS "sourceEntityId", r.source_revision AS "sourceRevision"
      FROM health_records r LEFT JOIN entities e ON e.entity_id = r.source_entity_id
      WHERE ${activeWeight(userId)}
      AND r.occurred_at >= ${new Date(Date.parse(from) - 86400000)}
      AND r.occurred_at < ${new Date(Date.parse(to) + 172800000)}
      ORDER BY r.occurred_at ASC, r.id ASC LIMIT 501`);
    if (rows.length > 500) throw new Error('METRIC_HISTORY_LIMIT');
    const records = rows.filter((row) => {
      const date = localDate(row.occurredAt, timezone);
      return date >= from && date <= to;
    });
    const snapshot = {
      from,
      to,
      timezone,
      metric: 'weight',
      unit: 'kg',
      records: records.map((row) => ({
        id: row.id,
        value: Number(row.value),
        occurredAt: row.occurredAt.toISOString(),
      })),
    };
    return {
      modelData: snapshot,
      snapshot,
      provenance: {
        entities: records.flatMap((row) =>
          row.sourceEntityId
            ? [{ entityId: row.sourceEntityId, revision: row.sourceRevision! }]
            : [],
        ),
        healthRecordIds: records.map((row) => row.id),
      },
    };
  }
}
