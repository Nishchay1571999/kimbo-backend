import { Inject, Injectable } from '@nestjs/common';
import { ENTRY_REPOSITORY } from '../../domain/entry.repository.js';
import type { EntryRepository } from '../../domain/entry.repository.js';
@Injectable()
export class DeleteEntryUseCase {
  constructor(
    @Inject(ENTRY_REPOSITORY) private readonly repository: EntryRepository,
  ) {}
  execute(userId: string, id: string) {
    return this.repository.delete(userId, id);
  }
}
