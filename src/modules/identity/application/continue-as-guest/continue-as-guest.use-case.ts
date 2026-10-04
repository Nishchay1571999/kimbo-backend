import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { USER_REPOSITORY } from '../../domain/user.repository.js';
import type { UserRepository } from '../../domain/user.repository.js';
import type { User } from '../../domain/user.js';
import { validateTimezone } from '../validate-timezone.js';
import type { ContinueAsGuestCommand } from './continue-as-guest.command.js';

@Injectable()
export class ContinueAsGuestUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  async execute(
    command: ContinueAsGuestCommand,
  ): Promise<{ user: User; token: string }> {
    const timezone = command.timezone ?? 'Asia/Kolkata';
    validateTimezone(timezone);
    const token = randomUUID();
    const user = await this.users.create({
      name: null,
      email: null,
      accountStatus: 'guest',
      timezone,
      authProviderId: token,
      passwordHash: null,
    });
    return { user, token };
  }
}
