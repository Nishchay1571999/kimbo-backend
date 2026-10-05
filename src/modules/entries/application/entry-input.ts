import {
  object,
  keys,
  text,
  number,
  optionalMacro,
} from '../../../common/validation/input.js';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { reportingDate } from '../../../common/time/calendar.js';
import type { UserIdentity } from '../../../common/identity/current-user.js';
import type {
  Attachment,
  EntryContent,
  EntryData,
  FoodItem,
} from '../domain/entry.types.js';
function choice<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (!allowed.includes(value as T))
    throw new BadRequestException(`Invalid ${label}`);
  return value as T;
}
export function categoryData(
  category: EntryContent['category'],
  value: unknown,
): EntryData {
  const data = object(value, 'data');
  if (category === 'note') {
    keys(data, []);
    return {};
  }
  if (category === 'exercise') {
    keys(data, [
      'activityName',
      'durationMinutes',
      'intensity',
      'estimatedCaloriesBurnedKcal',
      'calorieEstimationSource',
    ]);
    const burned = optionalMacro(
      data.estimatedCaloriesBurnedKcal,
      'estimatedCaloriesBurnedKcal',
    );
    const source =
      data.calorieEstimationSource == null
        ? null
        : text(data.calorieEstimationSource, 'calorieEstimationSource');
    if (burned !== null && !source)
      throw new BadRequestException('Calorie estimate requires a source');
    return {
      activityName: text(data.activityName, 'activityName'),
      durationMinutes: number(data.durationMinutes, 'durationMinutes', true),
      intensity: choice(
        data.intensity ?? 'moderate',
        ['light', 'moderate', 'vigorous'],
        'intensity',
      ),
      estimatedCaloriesBurnedKcal: burned,
      calorieEstimationSource: source,
    };
  }
  keys(data, ['mealCategory', 'items']);
  if (
    !Array.isArray(data.items) ||
    data.items.length === 0 ||
    data.items.length > 100
  )
    throw new BadRequestException('Nutrition requires 1–100 items');
  const items: FoodItem[] = data.items.map((raw) => {
    const item = object(raw, 'item');
    keys(item, [
      'id',
      'name',
      'quantity',
      'unit',
      'caloriesKcal',
      'proteinG',
      'carbohydratesG',
      'fatG',
      'quantitySource',
      'nutritionSource',
      'reference',
    ]);
    const result: FoodItem = {
      id: item.id === undefined ? randomUUID() : text(item.id, 'item.id', 100),
      name: text(item.name, 'item.name'),
      quantity: number(item.quantity, 'quantity', true),
      unit: text(item.unit, 'unit', 30),
      caloriesKcal: number(item.caloriesKcal, 'caloriesKcal'),
      proteinG: optionalMacro(item.proteinG, 'proteinG'),
      carbohydratesG: optionalMacro(item.carbohydratesG, 'carbohydratesG'),
      fatG: optionalMacro(item.fatG, 'fatG'),
      quantitySource: choice(
        item.quantitySource ?? 'user_entered',
        ['user_entered', 'estimated'],
        'quantitySource',
      ),
      nutritionSource: choice(
        item.nutritionSource ?? 'user_entered',
        ['user_entered', 'estimated', 'reference'],
        'nutritionSource',
      ),
    };
    if (result.nutritionSource === 'reference') {
      const ref = object(item.reference, 'reference');
      keys(ref, ['provider', 'providerFoodId', 'amount', 'unit']);
      result.reference = {
        provider: text(ref.provider, 'provider'),
        providerFoodId: text(ref.providerFoodId, 'providerFoodId'),
        amount: number(ref.amount, 'reference.amount', true),
        unit: text(ref.unit, 'reference.unit', 30),
      };
    } else if (item.reference !== undefined)
      throw new BadRequestException(
        'Reference requires nutritionSource reference',
      );
    return result;
  });
  if (new Set(items.map((i) => i.id)).size !== items.length)
    throw new BadRequestException('Duplicate food item IDs');
  return {
    mealCategory: choice(
      data.mealCategory,
      ['breakfast', 'lunch', 'dinner', 'snack', 'other'],
      'mealCategory',
    ),
    items,
  };
}
export function entryInput(
  raw: unknown,
  user: UserIdentity,
  existing?: EntryContent,
): EntryContent {
  const input = object(raw, 'entry');
  keys(input, [
    'category',
    'title',
    'entryDate',
    'occurredAt',
    'note',
    'attachments',
    'data',
    'revision',
  ]);
  if (!existing && 'revision' in input)
    throw new BadRequestException('revision is read-only on creation');
  if (
    existing &&
    Object.keys(input).filter((k) => k !== 'revision').length === 0
  )
    throw new BadRequestException('An edit is required');
  const merged = { ...existing, ...input };
  const category = choice(
    merged.category,
    ['nutrition', 'exercise', 'note'],
    'category',
  );
  if (existing && category !== existing.category && !('data' in input))
    throw new BadRequestException('Changing category requires data');
  const occurredAt = text(merged.occurredAt, 'occurredAt', 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      occurredAt,
    ) ||
    !Number.isFinite(Date.parse(occurredAt))
  )
    throw new BadRequestException(
      'occurredAt requires an ISO timestamp with offset',
    );
  reportingDate(occurredAt.slice(0, 10));
  const recordedTimezone = existing?.recordedTimezone ?? user.timezone;
  const attachmentsRaw = merged.attachments ?? [];
  if (!Array.isArray(attachmentsRaw) || attachmentsRaw.length > 10)
    throw new BadRequestException('attachments must contain at most 10 files');
  let totalAttachmentBytes = 0;
  const attachments: Attachment[] = attachmentsRaw.map((rawAttachment) => {
    const a = object(rawAttachment, 'attachment');
    keys(a, [
      'id',
      'type',
      'base64',
      'mimeType',
      'fileSizeBytes',
      'widthPx',
      'heightPx',
      'durationMs',
    ]);
    const type = choice(a.type, ['image', 'audio'], 'attachment.type');
    const mimeType = text(a.mimeType, 'mimeType', 100);
    if (
      !(
        type === 'image'
          ? ['image/jpeg', 'image/png', 'image/webp']
          : ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm']
      ).includes(mimeType)
    )
      throw new BadRequestException('Unsupported attachment MIME type');
    if (
      typeof a.base64 !== 'string' ||
      a.base64.length > Math.ceil((20 * 1024 * 1024) / 3) * 4 + 100
    )
      throw new BadRequestException(
        'Attachment requires Base64 (max 20 MB decoded)',
      );
    const prefix = `data:${mimeType};base64,`;
    const encoded = a.base64.startsWith(prefix)
      ? a.base64.slice(prefix.length)
      : a.base64;
    if (
      !encoded ||
      encoded.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
    )
      throw new BadRequestException('Invalid Base64 encoding');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded)
      throw new BadRequestException('Invalid Base64 encoding');
    const fileSizeBytes = bytes.length;
    totalAttachmentBytes += fileSizeBytes;
    if (totalAttachmentBytes > 20 * 1024 * 1024)
      throw new BadRequestException('Total decoded attachment limit is 20 MB');
    if (a.fileSizeBytes !== undefined && a.fileSizeBytes !== fileSizeBytes)
      throw new BadRequestException('fileSizeBytes does not match Base64 data');
    const matchesImage =
      mimeType === 'image/png'
        ? bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mimeType === 'image/jpeg'
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : mimeType === 'image/webp'
            ? bytes.toString('ascii', 0, 4) === 'RIFF' &&
              bytes.toString('ascii', 8, 12) === 'WEBP'
            : true;
    if (type === 'image' && !matchesImage)
      throw new BadRequestException('Image bytes do not match MIME type');
    const attachment: Attachment = {
      id: a.id === undefined ? randomUUID() : text(a.id, 'attachment.id', 100),
      type,
      base64: encoded,
      mimeType,
      fileSizeBytes,
    };
    for (const field of ['widthPx', 'heightPx', 'durationMs'] as const)
      if (a[field] !== undefined)
        attachment[field] = number(a[field], field, true);
    return attachment;
  });
  if (new Set(attachments.map((a) => a.id)).size !== attachments.length)
    throw new BadRequestException('Duplicate attachment IDs');
  const kinds = new Set(attachments.map((a) => a.type));
  const inputSource =
    attachments.length === 0
      ? 'text'
      : kinds.size > 1 || Boolean(merged.note)
        ? 'mixed'
        : attachments[0].type;
  return {
    category,
    title: text(merged.title ?? category, 'title', 100),
    entryDate: reportingDate(merged.entryDate),
    occurredAt: new Date(occurredAt).toISOString(),
    recordedTimezone,
    note: merged.note == null ? null : text(merged.note, 'note', 10000),
    attachments,
    inputSource,
    data: categoryData(category, merged.data ?? {}),
  };
}
