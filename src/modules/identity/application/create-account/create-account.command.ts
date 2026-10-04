export type CreateAccountCommand = {
  authProviderId?: string;
  name?: string;
  email?: string;
  password?: string;
  timezone: string;
};
