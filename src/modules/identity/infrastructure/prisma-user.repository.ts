import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../common/database/prisma.service.js';
import { AuthenticationError } from '../../../common/errors/domain.error.js';
import { ConflictError } from '../../../common/errors/conflict.error.js';
import type { UserRepository } from '../domain/user.repository.js';
import type {
  NewUser,
  User,
  UserCredentials,
  RegisterGuestInput,
} from '../domain/user.js';

const userSelection = {
  id: true,
  name: true,
  email: true,
  accountStatus: true,
  timezone: true,
  onboardingCompletedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.client.user.findUnique({
      where: { email },
      select: userSelection,
    });
  }

  async findCredentialsByEmail(email: string): Promise<UserCredentials | null> {
    const account = await this.prisma.client.user.findUnique({
      where: { email },
      select: { ...userSelection, authProviderId: true, passwordHash: true },
    });
    if (!account) return null;
    const { authProviderId, passwordHash, ...user } = account;
    return { user, authProviderId, passwordHash };
  }

  async registerGuest(input: RegisterGuestInput): Promise<User> {
    const { authProviderId, ...details } = input;
    try {
      // UPDATE rechecks account_status under the row lock: only one conversion wins.
      const users = await this.prisma.client.user.updateManyAndReturn({
        where: { authProviderId, accountStatus: 'guest' },
        data: { ...details, accountStatus: 'member' },
        select: userSelection,
      });
      if (users.length === 0) {
        throw new AuthenticationError(
          'INVALID_GUEST_TOKEN',
          'Guest account not found or already registered',
        );
      }
      return users[0];
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictError(
          'EMAIL_ALREADY_EXISTS',
          'An account with this email already exists',
        );
      }
      throw error;
    }
  }

  async create(input: NewUser): Promise<User> {
    try {
      return await this.prisma.client.user.create({
        data: input,
        select: userSelection,
      });
    } catch (error) {
      // The only client-supplied unique value in this insert is email.
      if (
        input.email !== null &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictError(
          'EMAIL_ALREADY_EXISTS',
          'An account with this email already exists',
        );
      }
      throw error;
    }
  }
}
