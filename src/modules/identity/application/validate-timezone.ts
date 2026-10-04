import { InvalidInputError } from '../../../common/errors/domain.error.js';

export function validateTimezone(timezone: string): void {
  // Intl accepts abbreviations and offsets; this API requires an IANA name.
  if (
    timezone !== 'UTC' &&
    !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(timezone)
  ) {
    throw new InvalidInputError(
      'INVALID_TIMEZONE',
      'Timezone must be a valid IANA timezone',
    );
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new InvalidInputError(
      'INVALID_TIMEZONE',
      'Timezone must be a valid IANA timezone',
    );
  }
}
