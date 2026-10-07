import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service.js';
import type { BodyWeightRepository } from '../domain/estimate.types.js';
@Injectable()
export class PrismaBodyWeightRepository implements BodyWeightRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  /** Newest non-void weight record, falling back to the onboarding weight. */
  async latestKg(userId: string): Promise<number | null> {
    const record = await this.prisma.client.healthRecord.findFirst({
      where: {
        userId,
        metricType: 'weight',
        isVoid: false,
        supersededBy: null,
      },
      orderBy: { occurredAt: 'desc' },
      select: { value: true, unit: true },
    });
    if (record) {
      const value = Number(record.value);
      return record.unit === 'lb' ? value * 0.45359237 : value;
    }
    const profile = await this.prisma.client.userHealthProfile.findUnique({
      where: { userId },
      select: { initialWeightKg: true },
    });
    return profile ? Number(profile.initialWeightKg) : null;
  }
}
