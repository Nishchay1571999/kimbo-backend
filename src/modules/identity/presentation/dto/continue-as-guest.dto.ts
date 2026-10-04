import { IsString, MaxLength, ValidateIf } from 'class-validator';

export class ContinueAsGuestDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(100)
  timezone?: string;
}
