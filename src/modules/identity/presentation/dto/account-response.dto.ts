import type { User } from '../../domain/user.js';

export class AccountResponseDto {
  id: string;
  name: string | null;
  email: string | null;
  accountStatus: 'guest' | 'member';
  timezone: string;
  onboardingCompleted: boolean;

  static fromUser(user: User): AccountResponseDto {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      accountStatus: user.accountStatus,
      timezone: user.timezone,
      onboardingCompleted: user.onboardingCompletedAt !== null,
    };
  }
}
