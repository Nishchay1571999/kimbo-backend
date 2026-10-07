import { object } from '../../../common/validation/input.js';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentUser,
  CurrentUserGuard,
} from '../../../common/identity/current-user.js';
import type { UserIdentity } from '../../../common/identity/current-user.js';
import { CreateEntryUseCase } from '../application/create-entry/create-entry.use-case.js';
import { GetEntryUseCase } from '../application/get-entry/get-entry.use-case.js';
import { ListEntriesUseCase } from '../application/list-entries/list-entries.use-case.js';
import { UpdateEntryUseCase } from '../application/update-entry/update-entry.use-case.js';
import { DeleteEntryUseCase } from '../application/delete-entry/delete-entry.use-case.js';
import { entryInput, newEntryInput } from '../application/entry-input.js';
@Controller('v1/entries')
@UseGuards(CurrentUserGuard)
export class EntriesController {
  constructor(
    @Inject(CreateEntryUseCase)
    private readonly createEntry: CreateEntryUseCase,
    @Inject(GetEntryUseCase) private readonly getEntry: GetEntryUseCase,
    @Inject(ListEntriesUseCase)
    private readonly listEntries: ListEntriesUseCase,
    @Inject(UpdateEntryUseCase)
    private readonly updateEntry: UpdateEntryUseCase,
    @Inject(DeleteEntryUseCase)
    private readonly deleteEntry: DeleteEntryUseCase,
  ) {}
  @Post() create(@CurrentUser() user: UserIdentity, @Body() body: unknown) {
    return this.createEntry.execute(user.userId, newEntryInput(body, user));
  }
  @Get() list(@CurrentUser() user: UserIdentity, @Query('date') date: string) {
    return this.listEntries.execute(user.userId, date);
  }
  @Get(':id') get(
    @CurrentUser() user: UserIdentity,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.getEntry.execute(user.userId, id);
  }
  @Patch(':id') async update(
    @CurrentUser() user: UserIdentity,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = object(body, 'entry');
    const current = await this.getEntry.execute(user.userId, id);
    const revision = input.revision ?? current.revision;
    if (
      typeof revision !== 'number' ||
      !Number.isInteger(revision) ||
      revision < 1
    )
      throw new BadRequestException('revision must be a positive integer');
    return this.updateEntry.execute(
      user.userId,
      id,
      entryInput(input, user, current),
      revision,
    );
  }
  @Delete(':id') @HttpCode(204) delete(
    @CurrentUser() user: UserIdentity,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.deleteEntry.execute(user.userId, id);
  }
}
