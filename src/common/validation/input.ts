import { BadRequestException } from '@nestjs/common';
export function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException(`${label} must be an object`);
  return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new BadRequestException('Unknown input field');
}
export function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new BadRequestException(
      `${label} must be a nonempty string (max ${max})`,
    );
  return value.trim();
}
export function number(
  value: unknown,
  label: string,
  positive = false,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (positive ? value <= 0 : value < 0)
  )
    throw new BadRequestException(
      `${label} must be a finite ${positive ? 'positive' : 'nonnegative'} number`,
    );
  return value;
}
export function optionalMacro(value: unknown, label: string): number | null {
  return value == null ? null : number(value, label);
}
