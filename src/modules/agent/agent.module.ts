import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { ChatPersistenceModule } from '../chat/chat-persistence.module.js';
import { HealthDataModule } from '../health/health-data.module.js';
import { ContextBuilder } from './context/context-builder.js';
import { ToolRegistry } from './tools/tool-registry.js';
import { AGENT_PROVIDER } from './domain/agent.types.js';
import { OpenRouterAgentProvider } from './providers/openrouter-agent.provider.js';
import { AgentRunner } from './agent-runner.js';
@Module({
  imports: [AiModule, ChatPersistenceModule, HealthDataModule],
  providers: [
    ContextBuilder,
    ToolRegistry,
    AgentRunner,
    { provide: AGENT_PROVIDER, useClass: OpenRouterAgentProvider },
  ],
  exports: [AgentRunner],
})
export class AgentModule {}
