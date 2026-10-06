import { Inject, Injectable } from '@nestjs/common';
import { AuthenticationError } from '../../../common/errors/domain.error.js';
import { USER_REPOSITORY } from '../domain/user.repository.js';
import type { UserRepository } from '../domain/user.repository.js';

@Injectable()
export class GetSessionUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(authorization?: string) {
    const token = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
    const user = token ? await this.users.findByAuthProviderId(token) : null;
    if (!user) throw new AuthenticationError('INVALID_SESSION', 'Please sign in again');
    return user;
  }
}
