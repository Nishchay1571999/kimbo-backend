import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
const uuid = z.uuid();
const nonblank = (max: number) => z.string().trim().min(1).max(max);
const threadCreate = z
  .object({ title: nonblank(200).optional(), aiModelId: uuid.optional() })
  .strict();
const threadUpdate = threadCreate
  .extend({ threadStatus: z.enum(['active', 'archived']).optional() })
  .strict()
  .refine((input) => Object.keys(input).length > 0);
const send = z
  .object({
    requestId: uuid,
    content: z
      .array(
        z.object({ type: z.literal('text'), text: nonblank(8000) }).strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException('Invalid chat input');
  return result.data;
}
export const createThreadInput = (body: unknown) =>
  parse(threadCreate, body ?? {});
export const updateThreadInput = (body: unknown) => parse(threadUpdate, body);
export function sendMessageInput(body: unknown) {
  const input = parse(send, body);
  const message = input.content.map((part) => part.text).join('\n');
  if (message.length > 8000)
    throw new BadRequestException('Message exceeds 8000 characters');
  return { requestId: input.requestId, message };
}
export function pageLimit(value: unknown, fallback = 50) {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'string' ||
    !/^\d+$/.test(value) ||
    Number(value) < 1 ||
    Number(value) > 100
  )
    throw new BadRequestException('limit must be 1–100');
  return Number(value);
}
export function beforeSequence(value: unknown) {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1
  )
    throw new BadRequestException('before must be a positive sequence number');
  return Number(value);
}
export function threadCursor(value: unknown) {
  if (value === undefined) return undefined;
  return parse(uuid, value);
}
