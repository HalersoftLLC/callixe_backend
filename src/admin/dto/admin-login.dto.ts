import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { Trim } from '../../common/validation/transforms';

export class AdminLoginDto {
  @Trim()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  // Not trimmed: spaces can be part of a password.
  // bcrypt only uses the first 72 bytes, so longer input is rejected rather
  // than silently cut off.
  @IsString()
  @Length(1, 72)
  password!: string;
}
