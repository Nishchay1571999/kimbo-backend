import { BadRequestException } from '@nestjs/common';
import { keys, object, text } from '../../../common/validation/input.js';
import type { EstimateRequest } from '../domain/estimate.types.js';
const MAX_IMAGE_BASE64 = Math.ceil((20 * 1024 * 1024) / 3) * 4;
export function estimateInput(raw: unknown): EstimateRequest {
  const input = object(raw, 'estimate');
  keys(input, ['category', 'title', 'note', 'image']);
  if (input.category !== 'nutrition' && input.category !== 'exercise')
    throw new BadRequestException('category must be nutrition or exercise');
  const image = object(input.image, 'image');
  keys(image, ['mimeType', 'base64']);
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(
      image.mimeType as string,
    )
  )
    throw new BadRequestException('Unsupported image MIME type');
  const mimeType = image.mimeType as string;
  const prefix = `data:${mimeType};base64,`;
  const base64 =
    typeof image.base64 === 'string' && image.base64.startsWith(prefix)
      ? image.base64.slice(prefix.length)
      : image.base64;
  if (
    typeof base64 !== 'string' ||
    !base64 ||
    base64.length > MAX_IMAGE_BASE64 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
  )
    throw new BadRequestException('image requires Base64 data (max 20 MB)');
  return {
    category: input.category,
    title: text(input.title, 'title', 100),
    note: text(input.note, 'note', 10000),
    image: { mimeType, base64 },
  };
}
