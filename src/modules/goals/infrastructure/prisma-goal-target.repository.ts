import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { activeWeight } from '../../health/infrastructure/health-history.repository.js';
import type {
  GoalTarget,
  GoalTargetRepository,
} from '../domain/goal-target.js';
const toTarget = (row: {
  caloriesKcal: number;
  proteinG: number;
  method: GoalTarget['method'];
  confirmedAt: Date;
}): GoalTarget => ({
  caloriesKcal: row.caloriesKcal,
  proteinG: row.proteinG,
  method: row.method,
  confirmedAt: row.confirmedAt.toISOString(),
});
@Injectable()
export class PrismaGoalTargetRepository implements GoalTargetRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async get(userId: string) {
    const row = await this.prisma.client.userGoalTarget.findUnique({
      where: { userId },
    });
    return row ? toTarget(row) : null;
  }
  async save(userId: string, target: Omit<GoalTarget, 'confirmedAt'>) {
    const data = { ...target, confirmedAt: new Date() };
    return toTarget(
      await this.prisma.client.userGoalTarget.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      }),
    );
  }
  async suggestionInput(userId: string) {
    const profile = await this.prisma.client.userHealthProfile.findUnique({
      where: { userId },
    });
    if (!profile) return null;
    const [weight] = await this.prisma.client.$queryRaw<
      { value: Prisma.Decimal }[]
    >(Prisma.sql`
      SELECT r.value FROM health_records r LEFT JOIN entities e ON e.entity_id = r.source_entity_id
      WHERE ${activeWeight(userId)} AND r.occurred_at <= NOW()
      ORDER BY r.occurred_at DESC, r.created_at DESC, r.id DESC LIMIT 1`);
    const years = Math.floor(
      (Date.now() - profile.ageRecordedOn.getTime()) / (365.25 * 86400000),
    );
    return {
      heightCm: Number(profile.heightCm),
      weightKg: Number(weight?.value ?? profile.initialWeightKg),
      age: profile.ageAtOnboarding + Math.max(0, years),
      gender: profile.gender,
      goalIntention: profile.goalIntention,
      exerciseFrequency: profile.exerciseFrequency,
    };
  }
}
