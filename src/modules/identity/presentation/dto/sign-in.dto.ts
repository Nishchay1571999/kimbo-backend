import { IsString, MaxLength, MinLength } from 'class-validator';

export class SignInDto {
  @IsString()
  @MaxLength(320)
  email: string;

  @IsString()
  @MinLength(7)
  @MaxLength(128)
  password: string;
}
