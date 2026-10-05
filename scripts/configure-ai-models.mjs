import 'dotenv/config';
import { createPrismaClient } from '../dist/common/database/prisma-client.js';
const prisma = createPrismaClient(process.env.DATABASE_URL);
try {
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Catalog status ${response.status}`);
  const { data } = await response.json();
  for (const providerModelId of [
    'openai/gpt-4o-mini',
    'google/gemini-2.5-flash-lite',
    'google/gemini-3.8-flash',
    'openai/gpt-5.4-mini',
  ]) {
    const remote = data.find((model) => model.id === providerModelId);
    if (
      !remote?.architecture?.input_modalities?.includes('image') ||
      !remote?.architecture?.output_modalities?.includes('text') ||
      !remote?.supported_parameters?.includes('structured_outputs')
    )
      throw new Error(`Required capabilities unavailable: ${providerModelId}`);
    const capabilities = {
      supportsText: true,
      supportsImages: true,
      supportsAudio: remote.architecture.input_modalities.includes('audio'),
    };
    const model = await prisma.aiModel.upsert({
      where: {
        provider_providerModelId: { provider: 'openrouter', providerModelId },
      },
      create: {
        name: remote.name.slice(0, 100),
        provider: 'openrouter',
        providerModelId,
        credentialReference: 'OPENROUTER_API_KEY',
        ...capabilities,
      },
      update: capabilities,
      select: {
        id: true,
        providerModelId: true,
        supportsImages: true,
        supportsAudio: true,
        isAvailable: true,
      },
    });
    console.log(JSON.stringify(model));
  }
  const chatPrimary = process.argv
    .find((arg) => arg.startsWith('--test-chat-primary='))
    ?.split('=')[1];
  if (chatPrimary) {
    const remote = data.find((model) => model.id === chatPrimary);
    if (!remote?.supported_parameters?.includes('tools'))
      throw new Error('Chat primary must support tools');
    const model = await prisma.aiModel.findFirstOrThrow({
      where: {
        providerModelId: chatPrimary,
        provider: 'openrouter',
        isAvailable: true,
        supportsText: true,
      },
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'test@email.com' },
      select: { id: true },
    });
    await prisma.userPreferences.upsert({
      where: { userId: user.id },
      create: { userId: user.id, preferredChatModelId: model.id },
      update: { preferredChatModelId: model.id },
    });
    console.log(
      JSON.stringify({
        account: 'test@email.com',
        chatPrimary: model.providerModelId,
      }),
    );
  }
} catch (error) {
  console.error(
    `Model configuration failed (${error?.code ?? error?.message ?? 'unknown'})`,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
