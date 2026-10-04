import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CREDENTIAL_HASHER } from '../../domain/credential-hasher.js';
import type { CredentialHasher } from '../../domain/credential-hasher.js';
import { normalizeEmail, validatePassword } from '../credentials.js';
import { validateTimezone } from '../validate-timezone.js';
import { ConflictError } from '../../../../common/errors/conflict.error.js';
import { InvalidInputError } from '../../../../common/errors/domain.error.js';
import { USER_REPOSITORY } from '../../domain/user.repository.js';
import type { UserRepository } from '../../domain/user.repository.js';
import type { User } from '../../domain/user.js';
import type { CreateAccountCommand } from './create-account.command.js';

@Injectable()
export class CreateAccountUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(CREDENTIAL_HASHER) private readonly credentials: CredentialHasher,
  ) {}

  async execute(command: CreateAccountCommand): Promise<User> {
    const name = command.name === undefined ? null : command.name.trim();
    if (name !== null && (name.length === 0 || name.length > 100)) {
      throw new InvalidInputError(
        'INVALID_NAME',
        'Name must contain between 1 and 100 characters',
      );
    }
    const email =
      command.email === undefined ? null : normalizeEmail(command.email);
    if (email !== null) {
      validatePassword(command.password);
    } else if (command.password !== undefined) {
      throw new InvalidInputError(
        'EMAIL_REQUIRED',
        'Email is required when providing a password',
      );
    }

    const timezone = command.timezone;
    validateTimezone(timezone);

    if (email !== null && (await this.users.findByEmail(email))) {
      throw new ConflictError(
        'EMAIL_ALREADY_EXISTS',
        'An account with this email already exists',
      );
    }

    let passwordHash: string | null = null;
    if (email !== null) {
      validatePassword(command.password);
      passwordHash = await this.credentials.hash(email, command.password);
    }
    if (command.authProviderId !== undefined) {
      if (email === null || passwordHash === null) {
        throw new InvalidInputError(
          'EMAIL_REQUIRED',
          'Email and password are required to register a guest',
        );
      }
      return this.users.registerGuest({
        authProviderId: command.authProviderId,
        name,
        email,
        passwordHash,
        timezone,
      });
    }
    return this.users.create({
      name,
      authProviderId: randomUUID(),
      passwordHash,
      email,
      timezone,
      accountStatus: email === null ? 'guest' : 'member',
    });
  }
}
