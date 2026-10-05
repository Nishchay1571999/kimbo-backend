import { Inject, Injectable } from '@nestjs/common';
import { ENTRY_REPOSITORY } from '../../domain/entry.repository.js';
import type { EntryRepository } from '../../domain/entry.repository.js';
import type { EntryContent } from '../../domain/entry.types.js';
@Injectable()
export class CreateEntryUseCase {
  constructor(
    @Inject(ENTRY_REPOSITORY) private readonly repository: EntryRepository,
  ) {}
  execute(userId: string, content: EntryContent) {
    return this.repository.create(userId, content);
  }
}
