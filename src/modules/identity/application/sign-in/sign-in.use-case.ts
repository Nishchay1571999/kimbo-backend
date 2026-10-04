import { Inject, Injectable } from '@nestjs/common';
import { AuthenticationError } from '../../../../common/errors/domain.error.js';
import { USER_REPOSITORY } from '../../domain/user.repository.js';
import type { UserRepository } from '../../domain/user.repository.js';
import { CREDENTIAL_HASHER } from '../../domain/credential-hasher.js';
import type { CredentialHasher } from '../../domain/credential-hasher.js';
import type { User } from '../../domain/user.js';
import { normalizeEmail, validatePassword } from '../credentials.js';
import type { SignInCommand } from './sign-in.command.js';

@Injectable()
export class SignInUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(CREDENTIAL_HASHER) private readonly credentials: CredentialHasher,
  ) {}

  async execute(
    command: SignInCommand,
  ): Promise<{ user: User; token: string }> {
    const email = normalizeEmail(command.email);
    validatePassword(command.password);
    const account = await this.users.findCredentialsByEmail(email);
    if (
      !account ||
      account.user.accountStatus !== 'member' ||
      !account.authProviderId ||
      !account.passwordHash ||
      !(await this.credentials.verify(
        account.passwordHash,
        email,
        command.password,
      ))
    ) {
      throw new AuthenticationError(
        'INVALID_CREDENTIALS',
        'Invalid email or password',
      );
    }
    return { user: account.user, token: account.authProviderId };
  }
}
