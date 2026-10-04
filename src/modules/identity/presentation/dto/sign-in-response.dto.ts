import { AccountResponseDto } from './account-response.dto.js';

export class SignInResponseDto extends AccountResponseDto {
  token: string;
  tokenType: 'Bearer';
}
