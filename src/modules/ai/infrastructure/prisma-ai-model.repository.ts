import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../common/database/prisma.service.js';
import type { AiModelRepository } from '../domain/ai-model.repository.js';
const select = {
  id: true,
  name: true,
  provider: true,
  providerModelId: true,
  supportsText: true,
  supportsImages: true,
  supportsAudio: true,
};
function allowed(audio = false) {
  return {
    provider: 'openrouter',
    isAvailable: true,
    supportsText: true,
    supportsImages: true,
    ...(audio ? { supportsAudio: true } : {}),
  };
}
@Injectable()
export class PrismaAiModelRepository implements AiModelRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService)
    private readonly config: ConfigService = new ConfigService(),
  ) {}
  async selectForChat(userId: string) {
    const preference = await this.prisma.client.userPreferences.findUnique({
      where: { userId },
      select: { preferredChatModelId: true },
    });
    if (preference?.preferredChatModelId) {
      const model = await this.findForChat(preference.preferredChatModelId);
      if (model) return model;
    }
    const configured = await this.findForChat(
      this.config.get<string>('CHAT_DEFAULT_MODEL') ??
        'google/gemini-3.8-flash',
    );
    if (configured) return configured;
    return this.prisma.client.aiModel.findFirst({
      where: { provider: 'openrouter', isAvailable: true, supportsText: true },
      select,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
  findForChat(idOrProviderModelId: string) {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        idOrProviderModelId,
      );
    return this.prisma.client.aiModel.findFirst({
      where: {
        provider: 'openrouter',
        isAvailable: true,
        supportsText: true,
        ...(isUuid
          ? { id: idOrProviderModelId }
          : { providerModelId: idOrProviderModelId }),
      },
      select,
    });
  }
  selectForEntry(_userId: string, audio: boolean) {
    return this.prisma.client.aiModel.findFirst({
      where: allowed(audio),
      select,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
  findAllowed(_userId: string, providerModelId: string, audio: boolean) {
    return this.prisma.client.aiModel.findFirst({
      where: { ...allowed(audio), providerModelId },
      select,
    });
  }
  list(_userId: string) {
    return this.prisma.client.aiModel.findMany({
      where: { provider: 'openrouter', isAvailable: true, supportsText: true },
      select,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
}
