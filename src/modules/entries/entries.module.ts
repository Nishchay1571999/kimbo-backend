import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/database/prisma.module.js';
import { CurrentUserModule } from '../../common/identity/current-user.js';
import { ENTRY_REPOSITORY } from './domain/entry.repository.js';
import { PrismaEntryRepository } from './infrastructure/prisma-entry.repository.js';
import { EntriesController } from './presentation/entries.controller.js';
import { CreateEntryUseCase } from './application/create-entry/create-entry.use-case.js';
import { GetEntryUseCase } from './application/get-entry/get-entry.use-case.js';
import { ListEntriesUseCase } from './application/list-entries/list-entries.use-case.js';
import { UpdateEntryUseCase } from './application/update-entry/update-entry.use-case.js';
import { DeleteEntryUseCase } from './application/delete-entry/delete-entry.use-case.js';
@Module({
  imports: [PrismaModule, CurrentUserModule],
  controllers: [EntriesController],
  providers: [
    { provide: ENTRY_REPOSITORY, useClass: PrismaEntryRepository },
    CreateEntryUseCase,
    GetEntryUseCase,
    ListEntriesUseCase,
    UpdateEntryUseCase,
    DeleteEntryUseCase,
  ],
  exports: [ENTRY_REPOSITORY, ListEntriesUseCase],
})
export class EntriesModule {}
