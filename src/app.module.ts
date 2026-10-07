import { EntriesModule } from './modules/entries/entries.module.js';
import { NutritionModule } from './modules/nutrition/nutrition.module.js';
import { HomeModule } from './modules/home/home.module.js';
import { AiModule } from './modules/ai/ai.module.js';
import { ChatModule } from './modules/chat/chat.module.js';
import { GoalsModule } from './modules/goals/goals.module.js';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './common/database/prisma.module.js';
import { HealthModule } from './health/health.module.js';

import { IdentityModule } from './modules/identity/identity.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

const optionalModules =
  process.env.OBSERVE_ENABLED === 'true' ? [ObserveModule] : [];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    IdentityModule,
    EntriesModule,
    NutritionModule,
    GoalsModule,
    HomeModule,
    AiModule,
    ChatModule,
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ...optionalModules,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
