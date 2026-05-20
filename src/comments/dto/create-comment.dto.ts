import { IsString, Length } from 'class-validator';

// authorId is NOT accepted here — it is sourced from the JWT (D7).
// forbidNonWhitelisted in the global ValidationPipe rejects any authorId in the body.
export class CreateCommentDto {
  @IsString()
  @Length(1, 5000)
  content: string;
}
