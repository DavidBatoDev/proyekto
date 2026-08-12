import {
  IsEmail,
  IsEnum,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum EmailVerificationPurpose {
  Signup = 'signup',
  Login = 'login',
}

export class EmailVerificationRequestDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(100)
  firstName: string;

  @IsString()
  @MaxLength(100)
  lastName: string;

  @IsEnum(EmailVerificationPurpose)
  purpose: EmailVerificationPurpose;
}

export class EmailVerificationConfirmDto {
  @IsEmail()
  email: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}

export class PasswordResetRequestDto {
  @IsEmail()
  email: string;
}

export class PasswordResetConfirmDto {
  @IsEmail()
  email: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code: string;

  @IsString()
  @MinLength(6)
  newPassword: string;
}
