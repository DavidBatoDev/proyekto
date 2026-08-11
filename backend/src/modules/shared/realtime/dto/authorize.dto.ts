import { IsString } from 'class-validator';

export class AuthorizeRealtimeDto {
  /** Room key the client wants to join, e.g. `roadmap:<id>` / `chatroom:<id>` / `user:<id>`. */
  @IsString()
  room: string;
}
