import { GetSessionUseCase } from './get-session.use-case.js';
import { AuthenticationError } from '../../../common/errors/domain.error.js';
import type { UserRepository } from '../domain/user.repository.js';
import { vi } from 'vitest';

describe('GetSessionUseCase', () => {
  const findByAuthProviderId = vi.fn();
  const users: UserRepository = {
    findByAuthProviderId,
    findByEmail: async () => null, findCredentialsByEmail: async () => null,
    create: async () => { throw new Error('Not used'); },
    registerGuest: async () => { throw new Error('Not used'); },
  };
  beforeEach(() => findByAuthProviderId.mockReset());

  it('restores an incomplete member or guest without requiring onboarding', async () => {
    for (const accountStatus of ['member', 'guest'] as const) {
      const user = { id: 'test-id', name: null, email: null, accountStatus, timezone: 'UTC', onboardingCompletedAt: null };
      findByAuthProviderId.mockResolvedValue(user);
      await expect(new GetSessionUseCase(users).execute('Bearer stored-token')).resolves.toEqual(user);
      expect(findByAuthProviderId).toHaveBeenCalledWith('stored-token');
    }
  });

  it.each([undefined, 'Basic token', 'Bearer', 'Bearer token extra'])('rejects malformed credentials %s without a lookup', async (authorization) => {
    await expect(new GetSessionUseCase(users).execute(authorization)).rejects.toBeInstanceOf(AuthenticationError);
    expect(findByAuthProviderId).not.toHaveBeenCalled();
  });

  it('rejects an unknown token without development fallback', async () => {
    findByAuthProviderId.mockResolvedValue(null);
    await expect(new GetSessionUseCase(users).execute('Bearer unknown')).rejects.toMatchObject({ code: 'INVALID_SESSION' });
  });
});
