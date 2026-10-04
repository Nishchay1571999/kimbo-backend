import {
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateAccountDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4')
  auth_provider_id?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4')
  authProviderId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(320)
  email?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(7)
  @MaxLength(128)
  password?: string;

  @IsString()
  @MaxLength(100)
  timezone: string;
}
