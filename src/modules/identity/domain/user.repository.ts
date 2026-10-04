import type {
  NewUser,
  User,
  UserCredentials,
  RegisterGuestInput,
} from './user.js';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  findCredentialsByEmail(email: string): Promise<UserCredentials | null>;
  /** Atomically converts only a guest; preserves its ID, token, and owned data. */
  registerGuest(input: RegisterGuestInput): Promise<User>;
  /** Throws ConflictError with EMAIL_ALREADY_EXISTS if email is already owned. */
  create(input: NewUser): Promise<User>;
}
