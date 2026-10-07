import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/database/prisma.module.js';
import { EntriesModule } from '../entries/entries.module.js';
import { HomeModule } from '../home/home.module.js';
import { GoalsModule } from '../goals/goals.module.js';
import { HealthProjectionService } from './application/health-projection.service.js';
import { HealthHistoryRepository } from './infrastructure/health-history.repository.js';
@Module({
  imports: [PrismaModule, EntriesModule, HomeModule, GoalsModule],
  providers: [HealthProjectionService, HealthHistoryRepository],
  exports: [HealthProjectionService, HealthHistoryRepository],
})
export class HealthDataModule {}
