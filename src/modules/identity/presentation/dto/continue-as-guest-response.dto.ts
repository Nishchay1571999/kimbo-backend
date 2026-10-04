import { SignInResponseDto } from './sign-in-response.dto.js';

export class ContinueAsGuestResponseDto extends SignInResponseDto {
  auth_provider_id: string;
}
