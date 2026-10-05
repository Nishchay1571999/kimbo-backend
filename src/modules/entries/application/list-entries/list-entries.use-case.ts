import { Inject, Injectable } from '@nestjs/common';
import { ENTRY_REPOSITORY } from '../../domain/entry.repository.js';
import type { EntryRepository } from '../../domain/entry.repository.js';
import { reportingDate } from '../../../../common/time/calendar.js';
@Injectable()
export class ListEntriesUseCase {
  constructor(
    @Inject(ENTRY_REPOSITORY) private readonly repository: EntryRepository,
  ) {}
  execute(userId: string, date: string) {
    return this.repository.list(userId, reportingDate(date));
  }
}
