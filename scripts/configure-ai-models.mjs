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
} catch (error) {
  console.error(
    `Model configuration failed (${error?.code ?? error?.message ?? 'unknown'})`,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
