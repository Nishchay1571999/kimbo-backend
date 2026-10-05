import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/database/prisma.module.js';
import { AiModule } from '../ai/ai.module.js';
import { ChatRepository } from './infrastructure/chat.repository.js';
@Module({
  imports: [PrismaModule, AiModule],
  providers: [ChatRepository],
  exports: [ChatRepository],
})
export class ChatPersistenceModule {}
