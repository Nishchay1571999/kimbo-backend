import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/database/prisma.module.js';
import { CurrentUserModule } from '../../common/identity/current-user.js';
import { GoalTargetService } from './application/goal-target.service.js';
import { GOAL_TARGET_REPOSITORY } from './domain/goal-target.js';
import { PrismaGoalTargetRepository } from './infrastructure/prisma-goal-target.repository.js';
import { GoalsController } from './presentation/goals.controller.js';
@Module({
  imports: [PrismaModule, CurrentUserModule],
  controllers: [GoalsController],
  providers: [
    GoalTargetService,
    { provide: GOAL_TARGET_REPOSITORY, useClass: PrismaGoalTargetRepository },
  ],
  exports: [GOAL_TARGET_REPOSITORY],
})
export class GoalsModule {}
