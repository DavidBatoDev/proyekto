import { IsString } from 'class-validator';

export class CreateGuestDto {
  @IsString() session_id: string;
}
