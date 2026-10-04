export const CREDENTIAL_HASHER = Symbol('CREDENTIAL_HASHER');

export interface CredentialHasher {
  hash(email: string, password: string): Promise<string>;
  verify(hash: string, email: string, password: string): Promise<boolean>;
}
