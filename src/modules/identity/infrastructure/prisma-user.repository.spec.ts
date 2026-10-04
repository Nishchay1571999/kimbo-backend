import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../common/database/prisma.service.js';
import { PrismaUserRepository } from './prisma-user.repository.js';

describe('PrismaUserRepository', () => {
  const create = vi.fn();
  const updateManyAndReturn = vi.fn();
  let repository: PrismaUserRepository;

  beforeEach(async () => {
    create.mockReset();
    updateManyAndReturn.mockReset();
    const module = await Test.createTestingModule({
      providers: [
        PrismaUserRepository,
        {
          provide: PrismaService,
          useValue: { client: { user: { create, updateManyAndReturn } } },
        },
      ],
    }).compile();
    repository = module.get(PrismaUserRepository);
  });

  it('translates a database uniqueness race into an application conflict', async () => {
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7.10.0',
        meta: { target: ['email'] },
      }),
    );
    await expect(
      repository.create({
        name: null,
        email: 'a@example.com',
        authProviderId: null,
        passwordHash: null,
        accountStatus: 'member',
        timezone: 'UTC',
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_EXISTS' });
  });

  it('converts only a guest without updating its auth provider ID', async () => {
    const guest = {
      id: 'same-user',
      name: 'test',
      email: 'test@email.com',
      accountStatus: 'member',
      timezone: 'UTC',
      onboardingCompletedAt: null,
    };
    updateManyAndReturn.mockResolvedValue([guest]);
    const input = {
      authProviderId: 'guest-token',
      name: 'test',
      email: 'test@email.com',
      passwordHash: 'hash',
      timezone: 'UTC',
    };
    expect(await repository.registerGuest(input)).toEqual(guest);
    const query = updateManyAndReturn.mock.calls[0][0];
    expect(query.where).toEqual({
      authProviderId: 'guest-token',
      accountStatus: 'guest',
    });
    expect(query.data).not.toHaveProperty('authProviderId');
    expect(query.data).not.toHaveProperty('id');
  });

  it('rejects an already-converted or unknown guest and translates uniqueness races', async () => {
    const input = {
      authProviderId: 'guest-token',
      name: 'test',
      email: 'test@email.com',
      passwordHash: 'hash',
      timezone: 'UTC',
    };
    updateManyAndReturn.mockResolvedValueOnce([]);
    await expect(repository.registerGuest(input)).rejects.toMatchObject({
      code: 'INVALID_GUEST_TOKEN',
    });
    updateManyAndReturn.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7.10.0',
      }),
    );
    await expect(repository.registerGuest(input)).rejects.toMatchObject({
      code: 'EMAIL_ALREADY_EXISTS',
    });
  });

  it('preserves unexpected database failures', async () => {
    const error = new Error('database unavailable');
    create.mockRejectedValue(error);
    await expect(
      repository.create({
        name: null,
        email: null,
        authProviderId: null,
        passwordHash: null,
        accountStatus: 'guest',
        timezone: 'UTC',
      }),
    ).rejects.toBe(error);
  });
});
