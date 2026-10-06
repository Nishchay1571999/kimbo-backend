import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { PrismaService } from '../../../common/database/prisma.service.js';
import { PrismaOnboardingRepository } from './prisma-onboarding.repository.js';

const input = { age: 28, heightCm: 152.4, weightKg: 72.5, gender: 'unspecified' as const,
  goalIntention: 'maintain' as const, healthyEatingFrequency: 'most_of_the_time' as const,
  exerciseFrequency: 'once_or_twice' as const, wakeTime: '07:00', sleepTime: '00:30' };
const user = { id: 'c115c629-d911-42aa-8e51-4a7d6db658ed', name: 'Test', email: 'test@email.com',
  accountStatus: 'member' as const, timezone: 'Asia/Kolkata', onboardingCompletedAt: null };

describe('PrismaOnboardingRepository', () => {
  const tx = {
    $queryRaw: vi.fn(), user: { findUnique: vi.fn(), update: vi.fn() },
    userHealthProfile: { findUnique: vi.fn(), create: vi.fn() }, healthRecord: { create: vi.fn() },
  };
  const transaction = vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx));
  let repository: PrismaOnboardingRepository;
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T20:00:00Z'));
    tx.user.findUnique.mockResolvedValue(user); tx.userHealthProfile.findUnique.mockResolvedValue(null);
    tx.healthRecord.create.mockResolvedValue({});
    tx.user.update.mockResolvedValue({ ...user, onboardingCompletedAt: new Date() });
    const module = await Test.createTestingModule({ providers: [PrismaOnboardingRepository,
      { provide: PrismaService, useValue: { client: { $transaction: transaction } } }] }).compile();
    repository = module.get(PrismaOnboardingRepository);
  });
  afterEach(() => vi.useRealTimers());

  it('locks the user and creates profile, initial weight and completion in one transaction', async () => {
    await repository.complete(user.id, input);
    expect(transaction).toHaveBeenCalledOnce(); expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.userHealthProfile.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: user.id, ageRecordedOn: new Date('2026-10-07'), initialWeightKg: 72.5,
      defaultWakeTime: new Date('1970-01-01T07:00:00Z'), defaultSleepTime: new Date('1970-01-01T00:30:00Z'),
    }) });
    expect(tx.healthRecord.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: user.id, metricType: 'weight', value: 72.5, unit: 'kg', source: 'user' }) });
    expect(tx.user.update).toHaveBeenCalledOnce();
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.user.findUnique.mock.invocationCallOrder[0]);
  });
  it('replays completed onboarding without changing facts or appending another weight', async () => {
    tx.user.findUnique.mockResolvedValue({ ...user, onboardingCompletedAt: new Date() });
    await repository.complete(user.id, input);
    expect(tx.userHealthProfile.create).not.toHaveBeenCalled();
    expect(tx.healthRecord.create).not.toHaveBeenCalled(); expect(tx.user.update).not.toHaveBeenCalled();
  });
  it('does not mark completion if the weight write fails', async () => {
    tx.healthRecord.create.mockRejectedValueOnce(new Error('weight write failed'));
    await expect(repository.complete(user.id, input)).rejects.toThrow('weight write failed');
    expect(tx.user.update).not.toHaveBeenCalled();
  });
  it('preserves an existing incomplete profile rather than overwriting its fixed schedule', async () => {
    tx.userHealthProfile.findUnique.mockResolvedValue({ userId: user.id });
    await expect(repository.complete(user.id, input)).rejects.toMatchObject({ code: 'ONBOARDING_PROFILE_EXISTS' });
    expect(tx.userHealthProfile.create).not.toHaveBeenCalled(); expect(tx.healthRecord.create).not.toHaveBeenCalled();
  });
});
