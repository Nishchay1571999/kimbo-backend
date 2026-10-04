import { ContinueAsGuestUseCase } from '../continue-as-guest/continue-as-guest.use-case.js';
import { AuthenticationError } from '../../../../common/errors/domain.error.js';
import { ScryptCredentialHasher } from '../../infrastructure/scrypt-credential-hasher.js';
import { randomUUID } from 'node:crypto';
import { CreateAccountUseCase } from './create-account.use-case.js';
import { ConflictError } from '../../../../common/errors/conflict.error.js';
import type { UserRepository } from '../../domain/user.repository.js';
import type { NewUser, User, RegisterGuestInput } from '../../domain/user.js';

class InMemoryUserRepository implements UserRepository {
  readonly users: (User & Pick<NewUser, 'authProviderId' | 'passwordHash'>)[] =
    [];

  async findByEmail(email: string): Promise<User | null> {
    return this.users.find((user) => user.email === email) ?? null;
  }

  async findCredentialsByEmail(email: string) {
    const user = this.users.find((account) => account.email === email);
    return user
      ? {
          user,
          authProviderId: user.authProviderId,
          passwordHash: user.passwordHash,
        }
      : null;
  }

  async registerGuest(input: RegisterGuestInput): Promise<User> {
    const user = this.users.find(
      (account) =>
        account.authProviderId === input.authProviderId &&
        account.accountStatus === 'guest',
    );
    if (!user)
      throw new AuthenticationError('INVALID_GUEST_TOKEN', 'Invalid guest');
    if (await this.findByEmail(input.email))
      throw new ConflictError('EMAIL_ALREADY_EXISTS', 'Duplicate email');
    Object.assign(user, input, { accountStatus: 'member' });
    return user;
  }

  async create(input: NewUser): Promise<User> {
    if (input.email !== null && (await this.findByEmail(input.email))) {
      throw new ConflictError(
        'EMAIL_ALREADY_EXISTS',
        'An account with this email already exists',
      );
    }
    const user = {
      ...input,
      id: randomUUID(),
      onboardingCompletedAt: null,
    };
    this.users.push(user);
    return user;
  }
}

describe('CreateAccountUseCase', () => {
  let users: InMemoryUserRepository;
  let useCase: CreateAccountUseCase;

  beforeEach(() => {
    users = new InMemoryUserRepository();
    useCase = new CreateAccountUseCase(users, new ScryptCredentialHasher());
  });

  it('creates independent guests with nullable emails and incomplete onboarding', async () => {
    const first = await useCase.execute({ timezone: 'Asia/Kolkata' });
    const second = await useCase.execute({ timezone: 'UTC' });
    expect(first).toMatchObject({
      email: null,
      accountStatus: 'guest',
      onboardingCompletedAt: null,
    });
    expect(second.id).not.toBe(first.id);
    expect(users.users).toHaveLength(2);
  });

  it('normalizes email before creating a member and checking uniqueness', async () => {
    const member = await useCase.execute({
      email: '  NISHCHAY@Example.COM  ',
      password: 'Test-password-123',
      timezone: 'Asia/Kolkata',
    });
    expect(member).toMatchObject({
      email: 'nishchay@example.com',
      accountStatus: 'member',
    });
    await expect(
      useCase.execute({
        email: 'Nishchay@Example.com',
        password: 'Test-password-123',
        timezone: 'UTC',
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_EXISTS' });
    expect(users.users).toHaveLength(1);
    expect(users.users[0]).toEqual(member);
  });

  it.each(['', '   ', 'invalid', 'a'.repeat(321)])(
    'rejects invalid email %j before persistence',
    async (email) => {
      await expect(
        useCase.execute({ email, timezone: 'UTC' }),
      ).rejects.toMatchObject({ code: 'INVALID_EMAIL' });
      expect(users.users).toHaveLength(0);
    },
  );

  it.each(['', 'Asia/Unknown', 'PST', '+05:30', ' UTC '])(
    'rejects invalid timezone %j before persistence',
    async (timezone) => {
      await expect(useCase.execute({ timezone })).rejects.toMatchObject({
        code: 'INVALID_TIMEZONE',
      });
      expect(users.users).toHaveLength(0);
    },
  );

  it('requires password for members and rejects password-only guest creation', async () => {
    await expect(
      useCase.execute({ email: 'a@example.com', timezone: 'UTC' }),
    ).rejects.toMatchObject({ code: 'INVALID_PASSWORD' });
    await expect(
      useCase.execute({ password: 'Test-password-123', timezone: 'UTC' }),
    ).rejects.toMatchObject({ code: 'EMAIL_REQUIRED' });
    expect(users.users).toHaveLength(0);
  });

  it('registers the same guest while preserving its token and onboarding', async () => {
    const guest = await new ContinueAsGuestUseCase(users).execute({});
    const completion = new Date('2026-10-04T00:00:00Z');
    guest.user.onboardingCompletedAt = completion;
    const converted = await useCase.execute({
      authProviderId: guest.token,
      name: 'guest test',
      email: ' GUEST@EMAIL.COM ',
      password: 'test123',
      timezone: 'UTC',
    });
    expect(converted.id).toBe(guest.user.id);
    expect(converted.onboardingCompletedAt).toBe(completion);
    expect(users.users).toHaveLength(1);
    const stored = await users.findCredentialsByEmail('guest@email.com');
    expect(stored?.authProviderId).toBe(guest.token);
    expect(stored?.user.accountStatus).toBe('member');
    expect(stored?.passwordHash).toBeTruthy();
    if (!stored?.passwordHash) throw new Error('Missing password hash');
    expect(
      await new ScryptCredentialHasher().verify(
        stored.passwordHash,
        'guest@email.com',
        'test123',
      ),
    ).toBe(true);
    await expect(
      useCase.execute({
        authProviderId: guest.token,
        email: 'other@email.com',
        password: 'test123',
        timezone: 'UTC',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_GUEST_TOKEN' });
  });

  it('leaves the guest untouched when the requested email is already owned', async () => {
    await useCase.execute({
      email: 'taken@email.com',
      password: 'test123',
      timezone: 'UTC',
    });
    const guest = await new ContinueAsGuestUseCase(users).execute({});
    await expect(
      useCase.execute({
        authProviderId: guest.token,
        email: 'TAKEN@EMAIL.COM',
        password: 'test123',
        timezone: 'UTC',
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_EXISTS' });
    expect(guest.user).toMatchObject({
      name: null,
      email: null,
      accountStatus: 'guest',
    });
    expect(users.users).toHaveLength(2);
  });

  it('rejects missing guest credentials and unknown guest tokens', async () => {
    await expect(
      useCase.execute({ authProviderId: randomUUID(), timezone: 'UTC' }),
    ).rejects.toMatchObject({ code: 'EMAIL_REQUIRED' });
    await expect(
      useCase.execute({
        authProviderId: randomUUID(),
        email: 'test@email.com',
        password: 'test123',
        timezone: 'UTC',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_GUEST_TOKEN' });
    expect(users.users).toHaveLength(0);
  });

  it('propagates a concurrent uniqueness conflict from the repository', async () => {
    const conflict = new ConflictError(
      'EMAIL_ALREADY_EXISTS',
      'Duplicate email',
    );
    const repository: UserRepository = {
      findByEmail: async () => null,
      findCredentialsByEmail: async () => null,
      registerGuest: async () => {
        throw new Error('Unexpected conversion');
      },
      create: async () => {
        throw conflict;
      },
    };
    await expect(
      new CreateAccountUseCase(
        repository,
        new ScryptCredentialHasher(),
      ).execute({
        email: 'a@example.com',
        password: 'Test-password-123',
        timezone: 'UTC',
      }),
    ).rejects.toBe(conflict);
  });
});
