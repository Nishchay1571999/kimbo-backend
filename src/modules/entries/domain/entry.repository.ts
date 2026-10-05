import type { Entry, EntryContent } from './entry.types.js';
export const ENTRY_REPOSITORY = Symbol('ENTRY_REPOSITORY');
export interface EntryRepository {
  create(userId: string, content: EntryContent): Promise<Entry>;
  get(userId: string, id: string): Promise<Entry | null>;
  list(userId: string, date: string): Promise<Entry[]>;
  update(
    userId: string,
    id: string,
    content: EntryContent,
    revision: number,
  ): Promise<Entry>;
  delete(userId: string, id: string): Promise<void>;
}
