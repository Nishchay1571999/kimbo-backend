import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service.js';
import type { HealthProfileRepository } from '../domain/health-profile.repository.js';
@Injectable()
export class PrismaHealthProfileRepository implements HealthProfileRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async get(userId: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: {
        timezone: true,
        healthProfile: {
          select: { defaultWakeTime: true, defaultSleepTime: true },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return {
      timezone: user.timezone,
      wakeTime:
        user.healthProfile?.defaultWakeTime.toISOString().slice(11, 16) ?? null,
      sleepTime:
        user.healthProfile?.defaultSleepTime.toISOString().slice(11, 16) ??
        null,
    };
  }
}
