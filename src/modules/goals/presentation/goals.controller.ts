import { Body, Controller, Get, Header, Inject, Put, UseGuards } from '@nestjs/common';
import {
  CurrentUser,
  CurrentUserGuard,
} from '../../../common/identity/current-user.js';
import type { UserIdentity } from '../../../common/identity/current-user.js';
import { GoalTargetService } from '../application/goal-target.service.js';
@Controller('v1/goals')
@UseGuards(CurrentUserGuard)
export class GoalsController {
  constructor(
    @Inject(GoalTargetService) private readonly targets: GoalTargetService,
  ) {}
  @Get('target')
  @Header('Cache-Control', 'no-store')
  get(@CurrentUser() user: UserIdentity) {
    return this.targets.get(user.userId);
  }
  @Put('target')
  confirm(@CurrentUser() user: UserIdentity, @Body() body: unknown) {
    return this.targets.confirm(user.userId, body);
  }
}
