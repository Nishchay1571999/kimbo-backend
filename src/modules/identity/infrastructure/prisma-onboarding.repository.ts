import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service.js';
import { AuthenticationError } from '../../../common/errors/domain.error.js';
import { ConflictError } from '../../../common/errors/conflict.error.js';
import { localDate } from '../../../common/time/calendar.js';
import type { OnboardingInput, OnboardingRepository } from '../domain/onboarding.repository.js';
import { userSelection } from './prisma-user.repository.js';

@Injectable()
export class PrismaOnboardingRepository implements OnboardingRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  complete(userId: string, input: OnboardingInput) {
    return this.prisma.client.$transaction(async (tx) => {
      // Serialize first submission and retries across instances, before reading completion.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: userId }, select: userSelection });
      if (!user) throw new AuthenticationError('INVALID_SESSION', 'Please sign in again');
      if (user.onboardingCompletedAt) return user;
      if (await tx.userHealthProfile.findUnique({ where: { userId } })) {
        throw new ConflictError('ONBOARDING_PROFILE_EXISTS', 'Your profile already exists. Please contact support to finish setup.');
      }
      const now = new Date();
      await tx.userHealthProfile.create({ data: {
        userId, heightCm: input.heightCm, initialWeightKg: input.weightKg,
        ageAtOnboarding: input.age, ageRecordedOn: new Date(localDate(now, user.timezone)),
        gender: input.gender, goalIntention: input.goalIntention,
        healthyEatingFrequency: input.healthyEatingFrequency, exerciseFrequency: input.exerciseFrequency,
        defaultWakeTime: new Date(`1970-01-01T${input.wakeTime}:00Z`),
        defaultSleepTime: new Date(`1970-01-01T${input.sleepTime}:00Z`),
      } });
      await tx.healthRecord.create({ data: {
        userId, metricType: 'weight', value: input.weightKg, unit: 'kg', occurredAt: now, source: 'user',
      } });
      return tx.user.update({ where: { id: userId }, data: { onboardingCompletedAt: now }, select: userSelection });
    });
  }
}
