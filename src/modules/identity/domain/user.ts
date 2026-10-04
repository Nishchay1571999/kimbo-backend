export type User = {
  id: string;
  name: string | null;
  email: string | null;
  accountStatus: 'guest' | 'member';
  timezone: string;
  onboardingCompletedAt: Date | null;
};

export type NewUser = Pick<
  User,
  'name' | 'email' | 'accountStatus' | 'timezone'
> & {
  authProviderId: string | null;
  passwordHash: string | null;
};

export type UserCredentials = {
  user: User;
  authProviderId: string | null;
  passwordHash: string | null;
};

export type RegisterGuestInput = {
  authProviderId: string;
  name: string | null;
  email: string;
  passwordHash: string;
  timezone: string;
};
