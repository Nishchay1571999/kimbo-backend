import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { CredentialHasher } from '../domain/credential-hasher.js';

const parameters = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const prefix = '$scrypt$32768$8$1$';

function derive(
  email: string,
  password: string,
  salt: Buffer,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Preserve exact passwords and keep email/password boundaries unambiguous.
    scrypt(
      JSON.stringify([email, password]),
      salt,
      64,
      parameters,
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

@Injectable()
export class ScryptCredentialHasher implements CredentialHasher {
  async hash(email: string, password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await derive(email, password, salt);
    return `${prefix}${salt.toString('base64url')}$${key.toString('base64url')}`;
  }

  async verify(
    encodedHash: string,
    email: string,
    password: string,
  ): Promise<boolean> {
    if (!encodedHash.startsWith(prefix)) return false;
    const parts = encodedHash.slice(prefix.length).split('$');
    if (parts.length !== 2) return false;
    const [saltText, keyText] = parts;
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(keyText, 'base64url');
    if (
      salt.length !== 16 ||
      expected.length !== 64 ||
      salt.toString('base64url') !== saltText ||
      expected.toString('base64url') !== keyText
    )
      return false;
    const actual = await derive(email, password, salt);
    return timingSafeEqual(actual, expected);
  }
}
