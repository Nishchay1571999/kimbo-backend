import { vi } from 'vitest';
import { CompleteOnboardingUseCase } from './complete-onboarding.use-case.js';
import { GetSessionUseCase } from './get-session.use-case.js';
import type { UserRepository } from '../domain/user.repository.js';

export const validOnboarding = { age: 28, heightCm: 152.4, weightKg: 72.5, gender: 'unspecified' as const,
  goalIntention: 'maintain' as const, healthyEatingFrequency: 'most_of_the_time' as const,
  exerciseFrequency: 'once_or_twice' as const, wakeTime: '07:00', sleepTime: '00:30' };
const user = { id: 'c115c629-d911-42aa-8e51-4a7d6db658ed', name: 'Test', email: 'test@email.com',
  accountStatus: 'member' as const, timezone: 'Asia/Kolkata', onboardingCompletedAt: null };

describe('CompleteOnboardingUseCase', () => {
  const findByAuthProviderId = vi.fn();
  const complete = vi.fn();
  const users: UserRepository = {
    findByAuthProviderId, findByEmail: async () => null, findCredentialsByEmail: async () => null,
    create: async () => { throw new Error('Not used'); }, registerGuest: async () => { throw new Error('Not used'); },
  };
  const useCase = new CompleteOnboardingUseCase(new GetSessionUseCase(users), { complete });
  beforeEach(() => { findByAuthProviderId.mockReset().mockResolvedValue(user); complete.mockReset().mockResolvedValue({ ...user, onboardingCompletedAt: new Date() }); });

  it.each(['member', 'guest'] as const)('accepts an overnight schedule for %s and binds the write to the bearer owner', async (accountStatus) => {
    findByAuthProviderId.mockResolvedValue({ ...user, accountStatus });
    complete.mockResolvedValue({ ...user, accountStatus, onboardingCompletedAt: new Date() });
    await expect(useCase.execute('Bearer test-token', validOnboarding)).resolves.toMatchObject({ id: user.id, accountStatus });
    expect(complete).toHaveBeenCalledWith(user.id, validOnboarding);
  });
  it.each([
    { ...validOnboarding, userId: 'spoofed' }, { ...validOnboarding, age: 17 },
    { ...validOnboarding, age: 28.5 }, { ...validOnboarding, weightKg: '72.5' },
    { ...validOnboarding, weightKg: -1 }, { ...validOnboarding, heightCm: 0 },
    { ...validOnboarding, sleepTime: '24:00' }, { ...validOnboarding, wakeTime: '7:00' },
    { ...validOnboarding, sleepTime: '07:00' }, { ...validOnboarding, gender: 'unknown' },
    { ...validOnboarding, exerciseFrequency: 'once-or-twice' }, {},
  ])('rejects invalid or spoofed input %j', async (body) => {
    await expect(useCase.execute('Bearer test-token', body)).rejects.toMatchObject({ code: 'INVALID_ONBOARDING' });
    expect(complete).not.toHaveBeenCalled();
  });
  it('requires a real bearer session before accepting onboarding', async () => {
    await expect(useCase.execute(undefined, validOnboarding)).rejects.toMatchObject({ code: 'INVALID_SESSION' });
    expect(complete).not.toHaveBeenCalled();
  });
});
