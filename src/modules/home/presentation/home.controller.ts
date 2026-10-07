import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import {
  CurrentUser,
  CurrentUserGuard,
} from '../../../common/identity/current-user.js';
import type { UserIdentity } from '../../../common/identity/current-user.js';
import { GetHomeUseCase } from '../application/get-home/get-home.use-case.js';
@Controller('v1/home')
@UseGuards(CurrentUserGuard)
export class HomeController {
  constructor(
    @Inject(GetHomeUseCase) private readonly getHome: GetHomeUseCase,
  ) {}
  @Get() get(@CurrentUser() user: UserIdentity, @Query('date') date?: string) {
    return this.getHome.execute(user.userId, date);
  }
  @Get('week') week(
    @CurrentUser() user: UserIdentity,
    @Query('date') date?: string,
  ) {
    return this.getHome.week(user.userId, date);
  }
}
