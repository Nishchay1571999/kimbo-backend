import { ScryptCredentialHasher } from './scrypt-credential-hasher.js';

describe('ScryptCredentialHasher', () => {
  const hasher = new ScryptCredentialHasher();

  it('hashes both email and password with a random salt and verifies the stored hash', async () => {
    const first = await hasher.hash('a@example.com', ' Password-123 ');
    const second = await hasher.hash('a@example.com', ' Password-123 ');
    expect(first).toMatch(/^\$scrypt\$/);
    expect(first).not.toEqual(second);
    expect(await hasher.verify(first, 'a@example.com', ' Password-123 ')).toBe(
      true,
    );
    expect(await hasher.verify(first, 'b@example.com', ' Password-123 ')).toBe(
      false,
    );
    expect(await hasher.verify(first, 'a@example.com', 'Password-123')).toBe(
      false,
    );
    expect(
      await hasher.verify('invalid-hash', 'a@example.com', ' Password-123 '),
    ).toBe(false);
  });
});
