import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ENTRY_REPOSITORY } from '../../domain/entry.repository.js';
import type { EntryRepository } from '../../domain/entry.repository.js';
@Injectable()
export class GetEntryUseCase {
  constructor(
    @Inject(ENTRY_REPOSITORY) private readonly repository: EntryRepository,
  ) {}
  async execute(userId: string, id: string) {
    const entry = await this.repository.get(userId, id);
    if (!entry) throw new NotFoundException('Entry not found');
    return entry;
  }
}
