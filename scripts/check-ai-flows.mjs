import { AI_MODEL_REPOSITORY } from '../dist/modules/ai/domain/ai-model.repository.js';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { PrismaService } from '../dist/common/database/prisma.service.js';
import { ENTRY_REPOSITORY } from '../dist/modules/entries/domain/entry.repository.js';
import { AnalyseEntryUseCase } from '../dist/modules/ai/application/analyse-entry/analyse-entry.use-case.js';

// A valid image fixture with a red square on white. The prompt does not disclose
// its content, so a successful description verifies actual image input.
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, bytes) {
  const type = Buffer.from(name);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, bytes])));
  return Buffer.concat([size, type, bytes, crc]);
}
function image() {
  const side = 256;
  const pixels = Buffer.alloc(side * (side * 3 + 1));
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const offset = y * (side * 3 + 1) + 1 + x * 3;
      const red = x >= 64 && x < 192 && y >= 64 && y < 192;
      pixels[offset] = 255;
      pixels[offset + 1] = red ? 0 : 255;
      pixels[offset + 2] = red ? 0 : 255;
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side);
  header.writeUInt32BE(side, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}
function audio() {
  const rate = 16000;
  const samples = rate;
  const header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(36 + samples * 2, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples * 2, 40);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++)
    data.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000),
      i * 2,
    );
  return Buffer.concat([header, data]).toString('base64');
}
process.env.DEV_AUTH_ENABLED = 'true';
process.env.DEV_USER_EMAIL = 'test@email.com';
delete process.env.DEV_USER_ID;
process.env.AI_WORKER_ENABLED = 'false';
let app, repository, user, modelRepository, originalSelect;
const ids = [];
const report = {
  account: 'test@email.com',
  checkedAt: new Date().toISOString(),
  results: [],
};
try {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const prisma = app.get(PrismaService).client;
  repository = app.get(ENTRY_REPOSITORY);
  user = await prisma.user.findUniqueOrThrow({
    where: { email: 'test@email.com' },
    select: { id: true },
  });
  const request = async (path, method = 'GET', body, expected = 200) => {
    const response = await fetch(`${base}/v1/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000),
    });
    assert.equal(response.status, expected, `${method} ${path}`);
    return response.status === 204 ? null : response.json();
  };
  const listed = await request('ai/models');
  assert.ok(
    listed.length > 0 &&
      listed.every((m) => m.supportsImages && m.supportsText),
  );
  modelRepository = app.get(AI_MODEL_REPOSITORY);
  originalSelect = modelRepository.selectForEntry.bind(modelRepository);
  const cases = process.argv.includes('--audio-only')
    ? []
    : listed.map((model) => ['image', model.providerModelId]);
  if (process.argv.includes('--audio') || process.argv.includes('--audio-only'))
    cases.push([
      'audio',
      listed.find((model) => model.supportsAudio)?.providerModelId,
    ]);
  for (const [kind, providerModelId] of cases) {
    assert.ok(providerModelId);
    modelRepository.selectForEntry = (userId, audio) =>
      modelRepository.findAllowed(userId, providerModelId, audio);
    const base64 = kind === 'image' ? image() : audio();
    const created = await request(
      'entries',
      'POST',
      {
        category: 'note',
        title: `Base64 ${kind} integration test`,
        entryDate: '2026-10-05',
        occurredAt: '2026-10-05T20:00:00+05:30',
        note:
          kind === 'image'
            ? 'Describe the attached image in your observations.'
            : 'Describe the attached audio in your observations.',
        attachments: [
          {
            type: kind,
            mimeType: kind === 'image' ? 'image/png' : 'audio/wav',
            base64,
          },
        ],
        data: {},
      },
      201,
    );
    ids.push(created.id);
    assert.equal(created.attachments[0].base64, base64);
    assert.equal(created.ai.status, 'pending');
    assert.equal(
      (await request(`entries/${created.id}`)).attachments[0].base64,
      base64,
    );
    assert.equal(
      (await request('entries?date=2026-10-05')).find(
        (e) => e.id === created.id,
      ).attachments[0].base64,
      base64,
    );
    assert.equal(
      await app.get(AnalyseEntryUseCase).execute(user.id, created.id),
      true,
    );
    const completed = await request(`entries/${created.id}`);
    if (completed.ai.status !== 'completed') {
      const row = await prisma.entity.findUniqueOrThrow({
        where: { entityId: created.id },
        include: { details: true },
      });
      report.results.push({
        kind,
        decodedBytes: Buffer.from(base64, 'base64').length,
        base64RoundTrip: true,
        providerModelId,
        status: completed.ai.status,
        errorCode: row.details.aiErrorCode,
      });
      throw new Error(
        `Live ${kind} analysis failed: ${row.details.aiErrorCode}`,
      );
    }
    const row = await prisma.entity.findUniqueOrThrow({
      where: { entityId: created.id },
      include: { details: { include: { aiModel: true } } },
    });
    assert.ok(listed.some((m) => m.id === row.details.aiModelId));
    assert.equal(row.details.aiModel.providerModelId, providerModelId);
    assert.equal(completed.revision, created.revision);
    if (kind === 'image')
      assert.match(
        JSON.stringify({
          synopsis: completed.ai.synopsis,
          structured: row.details.aiStructuredData,
        }),
        /red/i,
      );
    const result = {
      kind,
      entryId: created.id,
      decodedBytes: Buffer.from(base64, 'base64').length,
      base64RoundTrip: true,
      status: completed.ai.status,
      modelId: row.details.aiModelId,
      providerModelId: row.details.aiModel.providerModelId,
      synopsis: completed.ai.synopsis,
      structured: row.details.aiStructuredData,
      revision: completed.revision,
    };
    report.results.push(result);
    console.log(JSON.stringify(result));
  }
  await writeFile(
    new URL(
      process.argv.includes('--audio-only')
        ? '../docs/audio-live-verification.json'
        : '../docs/ai-live-verification.json',
      import.meta.url,
    ),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    'PASS: live OpenRouter Base64 input and registered-model attribution',
  );
} catch (error) {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : `AI flow check failed (${error?.code ?? (error?.message?.startsWith('Live ') ? error.message : error?.name) ?? 'unknown'})`,
  );
  process.exitCode = 1;
} finally {
  await writeFile(
    new URL(
      process.argv.includes('--audio-only')
        ? '../docs/audio-live-verification.json'
        : '../docs/ai-live-verification.json',
      import.meta.url,
    ),
    JSON.stringify(report, null, 2) + '\n',
  );
  if (modelRepository && originalSelect)
    modelRepository.selectForEntry = originalSelect;
  if (repository && user)
    for (const id of ids)
      if (await repository.get(user.id, id))
        await repository.delete(user.id, id);
  await app?.close();
}
