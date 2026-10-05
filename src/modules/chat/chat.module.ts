import { Module } from '@nestjs/common';
import { CurrentUserModule } from '../../common/identity/current-user.js';
import { AgentModule } from '../agent/agent.module.js';
import { ChatPersistenceModule } from './chat-persistence.module.js';
import { ChatController } from './presentation/chat.controller.js';
import { SendMessageUseCase } from './application/send-message.use-case.js';
@Module({
  imports: [CurrentUserModule, ChatPersistenceModule, AgentModule],
  controllers: [ChatController],
  providers: [SendMessageUseCase],
})
export class ChatModule {}
