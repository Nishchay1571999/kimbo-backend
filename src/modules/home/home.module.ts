import { PrismaHealthProfileRepository } from './infrastructure/prisma-health-profile.repository.js';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/database/prisma.module.js';
import { CurrentUserModule } from '../../common/identity/current-user.js';
import { EntriesModule } from '../entries/entries.module.js';
import { HEALTH_PROFILE_REPOSITORY } from './domain/health-profile.repository.js';
import { GetHomeUseCase } from './application/get-home/get-home.use-case.js';
import { HomeController } from './presentation/home.controller.js';
@Module({
  imports: [EntriesModule, PrismaModule, CurrentUserModule],
  controllers: [HomeController],
  providers: [
    GetHomeUseCase,
    {
      provide: HEALTH_PROFILE_REPOSITORY,
      useClass: PrismaHealthProfileRepository,
    },
  ],
  exports: [GetHomeUseCase, HEALTH_PROFILE_REPOSITORY],
})
export class HomeModule {}
