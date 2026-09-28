import { IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';

export const CONTACT_TOPICS = [
  'sales',
  'support',
  'partnership',
  'other',
] as const;

export type ContactTopic = (typeof CONTACT_TOPICS)[number];

/**
 * The public contact form's body.
 *
 * Every field the form sends must be declared here: the global ValidationPipe
 * runs `forbidNonWhitelisted`, so an undeclared field 400s the whole request
 * rather than being ignored.
 *
 * The lengths are abuse limits, not style guidance — this endpoint is
 * unauthenticated, so an unbounded message field is an unbounded email.
 */
export class SubmitContactMessageDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsEmail()
  @Length(3, 254)
  email!: string;

  @IsIn(CONTACT_TOPICS)
  topic!: ContactTopic;

  @IsString()
  @Length(10, 5000)
  message!: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  company?: string;
}
