import { isEmail } from 'class-validator';
import { InvalidInputError } from '../../../common/errors/domain.error.js';

export function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 320 || !isEmail(normalized)) {
    throw new InvalidInputError(
      'INVALID_EMAIL',
      'Email must be a valid email address',
    );
  }
  return normalized;
}

export function validatePassword(
  password: string | undefined,
): asserts password is string {
  if (
    typeof password !== 'string' ||
    password.length < 7 ||
    password.length > 128
  ) {
    throw new InvalidInputError(
      'INVALID_PASSWORD',
      'Password must contain between 7 and 128 characters',
    );
  }
}
