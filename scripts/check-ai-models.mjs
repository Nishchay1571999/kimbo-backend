import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { createPrismaClient } from '../dist/common/database/prisma-client.js';
const prisma = createPrismaClient(process.env.DATABASE_URL);
try {
  const models = await prisma.aiModel.findMany({
    select: {
      id: true,
      name: true,
      provider: true,
      providerModelId: true,
      supportsText: true,
      supportsImages: true,
      supportsAudio: true,
      isAvailable: true,
    },
  });
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Catalog status ${response.status}`);
  const { data } = await response.json();
  const imageModels = data.filter(
    (m) =>
      m.architecture?.input_modalities?.includes('image') &&
      m.architecture?.output_modalities?.includes('text') &&
      m.supported_parameters?.includes('structured_outputs'),
  );
  const shortlist = imageModels
    .filter((m) =>
      [
        'openai/gpt-4o-mini',
        'google/gemini-2.5-flash',
        'google/gemini-2.5-flash-lite',
      ].includes(m.id),
    )
    .map((m) => ({
      providerModelId: m.id,
      name: m.name,
      inputModalities: m.architecture.input_modalities,
      supportedParameters: m.supported_parameters,
      pricing: m.pricing,
    }));
  const report = {
    checkedAt: new Date().toISOString(),
    tableModels: models,
    verifiedTableModels: models.map((m) => ({
      ...m,
      listed: data.some((remote) => remote.id === m.providerModelId),
      verifiedImages: imageModels.some(
        (remote) => remote.id === m.providerModelId,
      ),
    })),
    shortlist,
  };
  await writeFile(
    new URL('../docs/ai-model-catalog-check.json', import.meta.url),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report));
} catch (e) {
  console.error(
    `Model verification failed (${e?.code ?? e?.message ?? 'unknown'})`,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
