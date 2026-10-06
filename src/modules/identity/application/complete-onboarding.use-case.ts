import { Inject, Injectable } from '@nestjs/common';
import { InvalidInputError } from '../../../common/errors/domain.error.js';
import { GetSessionUseCase } from './get-session.use-case.js';
import { ONBOARDING_REPOSITORY, onboardingSchema } from '../domain/onboarding.repository.js';
import type { OnboardingRepository } from '../domain/onboarding.repository.js';

@Injectable()
export class CompleteOnboardingUseCase {
  constructor(
    @Inject(GetSessionUseCase) private readonly session: GetSessionUseCase,
    @Inject(ONBOARDING_REPOSITORY) private readonly onboarding: OnboardingRepository,
  ) {}

  async execute(authorization: string | undefined, body: unknown) {
    const user = await this.session.execute(authorization);
    const parsed = onboardingSchema.safeParse(body);
    if (!parsed.success) throw new InvalidInputError('INVALID_ONBOARDING', parsed.error.issues.map((issue) => `${issue.path.join('.') || 'onboarding'}: ${issue.message}`).join('; '));
    return this.onboarding.complete(user.id, parsed.data);
  }
}
